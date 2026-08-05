'use strict'

const STAGES = Object.freeze(new Set([
  'extraccion',
  'importacion',
  'sincronizacion',
  'prueba'
]))

const TRIGGERS = Object.freeze(new Set([
  'manual',
  'programada',
  'evento'
]))

const FINAL_STATUSES = Object.freeze(new Set([
  'completada',
  'sin_datos',
  'fallida',
  'omitida'
]))

const ALL_STATUSES = Object.freeze(new Set([
  'iniciada',
  ...FINAL_STATUSES
]))

const SAFE_METRIC_KEYS = Object.freeze(new Set([
  'campanias',
  'registros_recibidos',
  'registros_procesados',
  'registros_nuevos',
  'registros_actualizados',
  'registros_asignados',
  'asignaciones_conservadas',
  'bytes',
  'archivo_existente'
]))

class IntegrationExecutionError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'IntegrationExecutionError'
    this.code = code
  }
}

function positiveInteger(value, field) {
  const normalized = String(value ?? '').trim()

  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new IntegrationExecutionError(
      'INTEGRATION_EXECUTION_ID_INVALID',
      `${field} debe ser un entero positivo`
    )
  }

  return normalized
}

function allowedValue(value, field, allowed) {
  const normalized = String(value ?? '').trim()

  if (!allowed.has(normalized)) {
    throw new IntegrationExecutionError(
      'INTEGRATION_EXECUTION_VALUE_INVALID',
      `${field} no es válido`
    )
  }

  return normalized
}

function normalizeErrorCode(value, required = false) {
  const normalized = String(value ?? '').trim()

  if (!normalized) {
    if (required) {
      throw new IntegrationExecutionError(
        'INTEGRATION_EXECUTION_ERROR_CODE_REQUIRED',
        'La ejecución fallida requiere un código controlado'
      )
    }

    return null
  }

  if (!/^[A-Z][A-Z0-9_]{0,99}$/.test(normalized)) {
    throw new IntegrationExecutionError(
      'INTEGRATION_EXECUTION_ERROR_CODE_INVALID',
      'El código de error no tiene un formato permitido'
    )
  }

  return normalized
}

function normalizeMetricValue(value, key) {
  if (key === 'archivo_existente') {
    if (typeof value !== 'boolean') {
      throw new IntegrationExecutionError(
        'INTEGRATION_EXECUTION_METRIC_INVALID',
        `${key} debe ser booleano`
      )
    }

    return value
  }

  if (
    !Number.isSafeInteger(value)
    || value < 0
  ) {
    throw new IntegrationExecutionError(
      'INTEGRATION_EXECUTION_METRIC_INVALID',
      `${key} debe ser un entero no negativo`
    )
  }

  return value
}

function normalizeMetrics(metrics = {}) {
  if (
    !metrics
    || Array.isArray(metrics)
    || typeof metrics !== 'object'
  ) {
    throw new IntegrationExecutionError(
      'INTEGRATION_EXECUTION_METRICS_INVALID',
      'Las métricas deben ser un objeto'
    )
  }

  const result = {}

  for (const [key, value] of Object.entries(metrics)) {
    if (!SAFE_METRIC_KEYS.has(key)) {
      throw new IntegrationExecutionError(
        'INTEGRATION_EXECUTION_METRIC_NOT_ALLOWED',
        `La métrica ${key} no está permitida`
      )
    }

    result[key] = normalizeMetricValue(value, key)
  }

  return result
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new IntegrationExecutionError(
      'INTEGRATION_EXECUTION_POOL_INVALID',
      'La conexión PostgreSQL no es válida'
    )
  }
}

async function withTransaction(pool, callback) {
  requirePool(pool)
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function startIntegrationExecution({
  pool,
  empresaId,
  integracionId,
  stage,
  trigger
}) {
  const companyId = positiveInteger(empresaId, 'empresa_id')
  const integrationId = positiveInteger(
    integracionId,
    'integracion_id'
  )
  const normalizedStage = allowedValue(
    stage,
    'etapa',
    STAGES
  )
  const normalizedTrigger = allowedValue(
    trigger,
    'disparador',
    TRIGGERS
  )

  return withTransaction(pool, async client => {
    const target = await client.query(
      `
      SELECT
        integracion.id::TEXT AS integracion_id,
        integracion.origen_id::TEXT AS origen_id
      FROM public.crm_integraciones integracion
      WHERE integracion.empresa_id = $1::INTEGER
        AND integracion.id = $2::BIGINT
        AND integracion.activo = TRUE
      FOR UPDATE
      `,
      [companyId, integrationId]
    )

    if (!target.rows[0]) {
      throw new IntegrationExecutionError(
        'INTEGRATION_EXECUTION_TARGET_NOT_FOUND',
        'La integración no existe, está inactiva o pertenece a otra empresa'
      )
    }

    await client.query(
      `
      UPDATE public.crm_integracion_ejecuciones
      SET
        estado = 'fallida',
        finalizada_at = NOW(),
        duracion_ms = GREATEST(
          0,
          ROUND(
            EXTRACT(EPOCH FROM (NOW() - iniciada_at))
            * 1000
          )::BIGINT
        ),
        error_codigo = 'INTEGRATION_EXECUTION_INTERRUPTED'
      WHERE empresa_id = $1::INTEGER
        AND integracion_id = $2::BIGINT
        AND estado = 'iniciada'
        AND iniciada_at < NOW() - INTERVAL '2 hours'
      `,
      [companyId, integrationId]
    )

    const active = await client.query(
      `
      SELECT id::TEXT AS id
      FROM public.crm_integracion_ejecuciones
      WHERE empresa_id = $1::INTEGER
        AND integracion_id = $2::BIGINT
        AND estado = 'iniciada'
      LIMIT 1
      `,
      [companyId, integrationId]
    )

    if (active.rows[0]) {
      throw new IntegrationExecutionError(
        'INTEGRATION_EXECUTION_ALREADY_ACTIVE',
        'La integración ya tiene una ejecución activa'
      )
    }

    const inserted = await client.query(
      `
      INSERT INTO public.crm_integracion_ejecuciones
      (
        empresa_id,
        origen_id,
        integracion_id,
        etapa,
        disparador
      )
      VALUES (
        $1::INTEGER,
        $5::BIGINT,
        $2::BIGINT,
        $3,
        $4
      )
      RETURNING
        id::TEXT AS id,
        empresa_id::TEXT AS empresa_id,
        origen_id::TEXT AS origen_id,
        integracion_id::TEXT AS integracion_id,
        etapa,
        disparador,
        estado,
        iniciada_at
      `,
      [
        companyId,
        integrationId,
        normalizedStage,
        normalizedTrigger,
        target.rows[0].origen_id
      ]
    )

    await client.query(
      `
      UPDATE public.crm_integraciones
      SET
        ultima_ejecucion_at = $3,
        ultimo_estado = 'iniciada',
        ultimo_error_codigo = NULL,
        actualizado_at = NOW()
      WHERE empresa_id = $1::INTEGER
        AND id = $2::BIGINT
      `,
      [
        companyId,
        integrationId,
        inserted.rows[0].iniciada_at
      ]
    )

    return inserted.rows[0]
  })
}

async function finishIntegrationExecution({
  pool,
  empresaId,
  executionId,
  status,
  metrics = {},
  errorCode
}) {
  const companyId = positiveInteger(empresaId, 'empresa_id')
  const id = positiveInteger(executionId, 'ejecucion_id')
  const normalizedStatus = allowedValue(
    status,
    'estado',
    FINAL_STATUSES
  )
  const normalizedMetrics = normalizeMetrics(metrics)
  const normalizedErrorCode = normalizeErrorCode(
    errorCode,
    normalizedStatus === 'fallida'
  )

  if (
    normalizedErrorCode
    && !['fallida', 'sin_datos'].includes(normalizedStatus)
  ) {
    throw new IntegrationExecutionError(
      'INTEGRATION_EXECUTION_ERROR_CODE_NOT_ALLOWED',
      'Este estado no admite código de error'
    )
  }

  return withTransaction(pool, async client => {
    const completed = await client.query(
      `
      UPDATE public.crm_integracion_ejecuciones
      SET
        estado = $3,
        finalizada_at = NOW(),
        duracion_ms = GREATEST(
          0,
          ROUND(
            EXTRACT(EPOCH FROM (NOW() - iniciada_at))
            * 1000
          )::BIGINT
        ),
        registros_recibidos = $4::INTEGER,
        registros_procesados = $5::INTEGER,
        metricas = $6::JSONB,
        error_codigo = $7
      WHERE empresa_id = $1::INTEGER
        AND id = $2::BIGINT
        AND estado = 'iniciada'
      RETURNING
        id::TEXT AS id,
        empresa_id::TEXT AS empresa_id,
        origen_id::TEXT AS origen_id,
        integracion_id::TEXT AS integracion_id,
        etapa,
        disparador,
        estado,
        iniciada_at,
        finalizada_at,
        duracion_ms::TEXT AS duracion_ms,
        registros_recibidos,
        registros_procesados,
        metricas,
        error_codigo
      `,
      [
        companyId,
        id,
        normalizedStatus,
        normalizedMetrics.registros_recibidos ?? null,
        normalizedMetrics.registros_procesados ?? null,
        JSON.stringify(normalizedMetrics),
        normalizedErrorCode
      ]
    )

    if (!completed.rows[0]) {
      throw new IntegrationExecutionError(
        'INTEGRATION_EXECUTION_NOT_ACTIVE',
        'La ejecución no existe, ya finalizó o pertenece a otra empresa'
      )
    }

    await client.query(
      `
      UPDATE public.crm_integraciones
      SET
        ultima_ejecucion_at = $3,
        ultimo_estado = $4,
        ultimo_error_codigo = $5,
        actualizado_at = NOW()
      WHERE empresa_id = $1::INTEGER
        AND id = $2::BIGINT
      `,
      [
        companyId,
        completed.rows[0].integracion_id,
        completed.rows[0].finalizada_at,
        normalizedStatus,
        normalizedErrorCode
      ]
    )

    return completed.rows[0]
  })
}

async function listIntegrationExecutions({
  pool,
  empresaId,
  integracionId,
  limit = 20
}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new IntegrationExecutionError(
      'INTEGRATION_EXECUTION_POOL_INVALID',
      'La conexión PostgreSQL no es válida'
    )
  }

  const companyId = positiveInteger(empresaId, 'empresa_id')
  const integrationId = positiveInteger(
    integracionId,
    'integracion_id'
  )
  const normalizedLimit = Number(limit)

  if (
    !Number.isSafeInteger(normalizedLimit)
    || normalizedLimit < 1
    || normalizedLimit > 100
  ) {
    throw new IntegrationExecutionError(
      'INTEGRATION_EXECUTION_LIMIT_INVALID',
      'El límite debe estar entre 1 y 100'
    )
  }

  const result = await pool.query(
    `
    SELECT
      ejecucion.id::TEXT AS id,
      ejecucion.integracion_id::TEXT AS integracion_id,
      ejecucion.etapa,
      ejecucion.disparador,
      ejecucion.estado,
      ejecucion.iniciada_at,
      ejecucion.finalizada_at,
      ejecucion.duracion_ms::TEXT AS duracion_ms,
      ejecucion.registros_recibidos,
      ejecucion.registros_procesados,
      ejecucion.metricas,
      ejecucion.error_codigo
    FROM public.crm_integracion_ejecuciones ejecucion
    WHERE ejecucion.empresa_id = $1::INTEGER
      AND ejecucion.integracion_id = $2::BIGINT
    ORDER BY ejecucion.iniciada_at DESC, ejecucion.id DESC
    LIMIT $3::INTEGER
    `,
    [companyId, integrationId, normalizedLimit]
  )

  return result.rows
}

async function listCompanyIntegrationExecutions({
  pool,
  empresaId,
  origenId,
  integracionId,
  status,
  stage,
  limit = 50
}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new IntegrationExecutionError(
      'INTEGRATION_EXECUTION_POOL_INVALID',
      'La conexión PostgreSQL no es válida'
    )
  }

  const params = [positiveInteger(empresaId, 'empresa_id')]
  const conditions = [
    'ejecucion.empresa_id = $1::INTEGER'
  ]

  if (origenId !== undefined && origenId !== '') {
    params.push(positiveInteger(origenId, 'origen_id'))
    conditions.push(
      `origen.id = $${params.length}::BIGINT`
    )
  }

  if (integracionId !== undefined && integracionId !== '') {
    params.push(positiveInteger(
      integracionId,
      'integracion_id'
    ))
    conditions.push(
      `ejecucion.integracion_id = $${params.length}::BIGINT`
    )
  }

  if (status !== undefined && status !== '') {
    params.push(allowedValue(
      status,
      'estado',
      ALL_STATUSES
    ))
    conditions.push(
      `ejecucion.estado = $${params.length}::TEXT`
    )
  }

  if (stage !== undefined && stage !== '') {
    params.push(allowedValue(stage, 'etapa', STAGES))
    conditions.push(
      `ejecucion.etapa = $${params.length}::TEXT`
    )
  }

  const normalizedLimit = Number(limit)

  if (
    !Number.isSafeInteger(normalizedLimit)
    || normalizedLimit < 1
    || normalizedLimit > 100
  ) {
    throw new IntegrationExecutionError(
      'INTEGRATION_EXECUTION_LIMIT_INVALID',
      'El límite debe estar entre 1 y 100'
    )
  }

  params.push(normalizedLimit)

  const result = await pool.query(
    `
    SELECT
      ejecucion.id::TEXT AS id,
      ejecucion.integracion_id::TEXT AS integracion_id,
      integracion.nombre AS integracion_nombre,
      integracion.codigo AS integracion_codigo,
      origen.id::TEXT AS origen_id,
      origen.nombre AS origen_nombre,
      origen.codigo AS origen_codigo,
      ejecucion.etapa,
      ejecucion.disparador,
      ejecucion.estado,
      ejecucion.iniciada_at,
      ejecucion.finalizada_at,
      ejecucion.duracion_ms::TEXT AS duracion_ms,
      ejecucion.registros_recibidos,
      ejecucion.registros_procesados,
      ejecucion.metricas,
      ejecucion.error_codigo
    FROM public.crm_integracion_ejecuciones ejecucion
    INNER JOIN public.crm_integraciones integracion
      ON integracion.empresa_id = ejecucion.empresa_id
      AND integracion.id = ejecucion.integracion_id
    INNER JOIN public.crm_origenes origen
      ON origen.empresa_id = integracion.empresa_id
      AND origen.id = integracion.origen_id
    WHERE ${conditions.join('\n      AND ')}
    ORDER BY ejecucion.iniciada_at DESC, ejecucion.id DESC
    LIMIT $${params.length}::INTEGER
    `,
    params
  )

  return result.rows
}

module.exports = {
  ALL_STATUSES,
  FINAL_STATUSES,
  IntegrationExecutionError,
  SAFE_METRIC_KEYS,
  STAGES,
  TRIGGERS,
  finishIntegrationExecution,
  listCompanyIntegrationExecutions,
  listIntegrationExecutions,
  normalizeErrorCode,
  normalizeMetrics,
  startIntegrationExecution
}
