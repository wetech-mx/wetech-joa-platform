'use strict'

const {
  finishIntegrationExecution,
  startIntegrationExecution
} = require(
  '../../repositories/integration-execution-repository'
)

const ORIGIN_CODE = 'banco_azteca'
const INTEGRATION_CODE = 'banco_azteca_api'

class BancoAztecaExecutionMonitorError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'BancoAztecaExecutionMonitorError'
    this.code = code
  }
}

function parseCompanyId(value) {
  const normalized = String(value ?? '').trim()

  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new BancoAztecaExecutionMonitorError(
      'BAZ_EXECUTION_COMPANY_INVALID',
      'BAZ_IMPORT_EMPRESA_ID debe ser un entero positivo'
    )
  }

  const parsed = Number(normalized)

  if (!Number.isSafeInteger(parsed)) {
    throw new BancoAztecaExecutionMonitorError(
      'BAZ_EXECUTION_COMPANY_INVALID',
      'BAZ_IMPORT_EMPRESA_ID está fuera del rango permitido'
    )
  }

  return parsed
}

function controlledErrorCode(error, fallback) {
  const candidate = String(error?.code || '').trim()

  if (/^BAZ_[A-Z0-9_]{1,96}$/.test(candidate)) {
    return candidate
  }

  return fallback
}

function safeIntegerMetric(target, key, value) {
  if (Number.isSafeInteger(value) && value >= 0) {
    target[key] = value
  }
}

function classifyExportResult(result = {}) {
  if (result.status === 'already_exists') {
    return {
      status: 'omitida',
      metrics: {
        archivo_existente: true
      }
    }
  }

  const metrics = {}
  safeIntegerMetric(metrics, 'campanias', result.campaigns)
  safeIntegerMetric(
    metrics,
    'registros_recibidos',
    result.clients
  )
  safeIntegerMetric(metrics, 'bytes', result.bytes)

  return {
    status: 'completada',
    metrics
  }
}

function classifyImportResult(result = {}) {
  const metrics = {}
  safeIntegerMetric(metrics, 'campanias', result.campaigns)
  safeIntegerMetric(
    metrics,
    'registros_recibidos',
    result.totalRows
  )
  safeIntegerMetric(
    metrics,
    'registros_procesados',
    result.totalRows
  )
  safeIntegerMetric(
    metrics,
    'registros_nuevos',
    result.newRecords
  )
  safeIntegerMetric(
    metrics,
    'registros_actualizados',
    result.updatedRecords
  )
  safeIntegerMetric(
    metrics,
    'registros_asignados',
    result.assignedRecords
  )
  safeIntegerMetric(
    metrics,
    'asignaciones_conservadas',
    result.keptAssignments
  )

  return {
    status: result.status === 'already_imported'
      ? 'omitida'
      : 'completada',
    metrics
  }
}

function classifyOperationError(error, fallbackCode) {
  const errorCode = controlledErrorCode(error, fallbackCode)

  return {
    status: errorCode === 'BAZ_EMPTY_RESPONSE'
      ? 'sin_datos'
      : 'fallida',
    metrics: {},
    errorCode
  }
}

async function resolveBancoAztecaIntegrationContext(
  pool,
  empresaId
) {
  if (!pool || typeof pool.query !== 'function') {
    throw new BancoAztecaExecutionMonitorError(
      'BAZ_EXECUTION_POOL_INVALID',
      'La conexión PostgreSQL no es válida'
    )
  }

  const companyId = parseCompanyId(empresaId)
  const result = await pool.query(
    `
    SELECT
      origen.id::TEXT AS origen_id,
      integracion.id::TEXT AS integracion_id
    FROM public.crm_origenes origen
    JOIN public.crm_integraciones integracion
      ON integracion.empresa_id = origen.empresa_id
      AND integracion.origen_id = origen.id
    WHERE origen.empresa_id = $1::INTEGER
      AND origen.codigo = $2
      AND origen.activo = TRUE
      AND integracion.codigo = $3
      AND integracion.activo = TRUE
    `,
    [companyId, ORIGIN_CODE, INTEGRATION_CODE]
  )

  if (result.rows.length !== 1) {
    throw new BancoAztecaExecutionMonitorError(
      'BAZ_EXECUTION_INTEGRATION_NOT_FOUND',
      'La integración activa de Banco Azteca no está disponible'
    )
  }

  return {
    origenId: result.rows[0].origen_id,
    integracionId: result.rows[0].integracion_id
  }
}

function reportMonitoringError(phase, error) {
  console.error('BANCO_AZTECA_EXECUTION_MONITOR_ERROR', {
    phase,
    code: controlledErrorCode(
      error,
      'BAZ_EXECUTION_MONITOR_UNEXPECTED'
    )
  })
}

async function monitorBancoAztecaExecution({
  pool,
  empresaId,
  stage,
  operation,
  classifyResult,
  fallbackErrorCode,
  resolveContextFn = resolveBancoAztecaIntegrationContext,
  startFn = startIntegrationExecution,
  finishFn = finishIntegrationExecution,
  reportErrorFn = reportMonitoringError
}) {
  if (typeof operation !== 'function') {
    throw new BancoAztecaExecutionMonitorError(
      'BAZ_EXECUTION_OPERATION_INVALID',
      'La operación monitoreada no es válida'
    )
  }

  let context = null
  let execution = null

  try {
    context = await resolveContextFn(pool, empresaId)
  } catch (error) {
    reportErrorFn('resolve', error)
  }

  if (context) {
    try {
      execution = await startFn({
        pool,
        empresaId,
        integracionId: context.integracionId,
        stage,
        trigger: 'programada'
      })
    } catch (error) {
      reportErrorFn('start', error)
    }
  }

  try {
    const result = await operation(context)

    if (execution) {
      try {
        const completion = classifyResult(result)

        await finishFn({
          pool,
          empresaId,
          executionId: execution.id,
          ...completion
        })
      } catch (error) {
        reportErrorFn('finish', error)
      }
    }

    return result
  } catch (error) {
    if (execution) {
      try {
        await finishFn({
          pool,
          empresaId,
          executionId: execution.id,
          ...classifyOperationError(
            error,
            fallbackErrorCode
          )
        })
      } catch (monitorError) {
        reportErrorFn('finish', monitorError)
      }
    }

    throw error
  }
}

module.exports = {
  BancoAztecaExecutionMonitorError,
  INTEGRATION_CODE,
  ORIGIN_CODE,
  classifyExportResult,
  classifyImportResult,
  classifyOperationError,
  controlledErrorCode,
  monitorBancoAztecaExecution,
  parseCompanyId,
  reportMonitoringError,
  resolveBancoAztecaIntegrationContext
}
