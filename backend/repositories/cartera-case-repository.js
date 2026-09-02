'use strict'

const { ROLES } = require('../config/constants')
const {
  normalizeBigintId,
  resolveAccessScope
} = require('./cartera-read-repository')

const CASE_PRIORITIES = new Set([
  'baja',
  'media',
  'alta',
  'urgente'
])

const CASE_STATES = new Set([
  'nuevo',
  'en_proceso',
  'en_espera',
  'resuelto',
  'cerrado'
])

class CarteraCaseError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'CarteraCaseError'
    this.code = code
    this.status = status
  }
}

function normalizeText(value, field, maximum, { required = true } = {}) {
  const text = String(value ?? '').trim()

  if (required && !text) {
    throw new CarteraCaseError(
      'CARTERA_CASE_TEXT_REQUIRED',
      `${field} es obligatorio`
    )
  }

  if (text.length > maximum) {
    throw new CarteraCaseError(
      'CARTERA_CASE_TEXT_TOO_LONG',
      `${field} excede la longitud permitida`
    )
  }

  return text || null
}

function normalizeEnum(value, field, allowed, defaultValue) {
  const normalized = String(value ?? defaultValue)
    .trim()
    .toLowerCase()

  if (!allowed.has(normalized)) {
    throw new CarteraCaseError(
      'CARTERA_CASE_ENUM_INVALID',
      `${field} no es válido`
    )
  }

  return normalized
}

function normalizeUserId(value) {
  const text = String(value ?? '').trim()

  if (!/^[1-9]\d*$/.test(text)) {
    throw new CarteraCaseError(
      'CARTERA_CASE_ASSIGNEE_INVALID',
      'El responsable no es válido'
    )
  }

  const id = Number(text)

  if (!Number.isSafeInteger(id)) {
    throw new CarteraCaseError(
      'CARTERA_CASE_ASSIGNEE_INVALID',
      'El responsable está fuera del rango permitido'
    )
  }

  return id
}

function normalizeVersion(value) {
  const text = String(value ?? '').trim()

  if (!/^[1-9]\d*$/.test(text)) {
    throw new CarteraCaseError(
      'CARTERA_CASE_VERSION_REQUIRED',
      'Actualice el caso antes de guardar',
      409
    )
  }

  const version = Number(text)

  if (!Number.isSafeInteger(version)) {
    throw new CarteraCaseError(
      'CARTERA_CASE_VERSION_REQUIRED',
      'La versión del caso está fuera del rango permitido',
      409
    )
  }

  return version
}

function resolveCaseActor(usuario) {
  const scope = resolveAccessScope(usuario)
  const actorId = normalizeUserId(usuario?.id)

  return {
    ...scope,
    actorId,
    isAdministrator: (
      usuario?.rol === ROLES.ADMIN
      || usuario?.rol === ROLES.SUPER_ADMIN
    )
  }
}

async function withTransaction(pool, callback) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new CarteraCaseError(
      'CARTERA_CASE_POOL_INVALID',
      'La conexión de datos no es válida',
      500
    )
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // El error original conserva la prioridad.
    }
    throw error
  } finally {
    client.release()
  }
}

async function lockAccessibleAccount(client, actor, accountId) {
  const values = [accountId, actor.empresaId]
  let access = ''

  if (actor.isExecutive) {
    values.push(actor.actorId)
    access = `
      AND (
        EXISTS (
          SELECT 1
          FROM public.cartera_asignaciones a
          WHERE
            a.cuenta_id = c.id
            AND a.usuario_id = $3
            AND a.activa = TRUE
        )
        OR EXISTS (
          SELECT 1
          FROM public.cartera_campanias cp
          WHERE
            cp.empresa_id = c.empresa_id
            AND cp.origen_id = c.origen_id
            AND cp.codigo = c.id_campania
            AND cp.activa = TRUE
            AND cp.modo_distribucion = 'abierta'
        )
      )
    `
  }

  const result = await client.query(
    `
    SELECT
      c.id,
      c.id_campania,
      c.origen_id,
      c.activa
    FROM public.cartera_cuentas c
    WHERE
      c.id = $1
      AND c.empresa_id = $2
      ${access}
    FOR SHARE
    `,
    values
  )

  if (!result.rows[0]) {
    throw new CarteraCaseError(
      'CARTERA_CASE_ACCOUNT_NOT_FOUND',
      'La cuenta no existe o no pertenece al alcance',
      404
    )
  }

  return result.rows[0]
}

async function requireExecutiveAssignee(client, empresaId, userId) {
  const result = await client.query(
    `
    SELECT id, nombre
    FROM public.usuarios
    WHERE
      id = $1
      AND empresa_id = $2
      AND activo = TRUE
      AND rol = $3
    FOR SHARE
    `,
    [userId, empresaId, ROLES.EJECUTIVO]
  )

  if (!result.rows[0]) {
    throw new CarteraCaseError(
      'CARTERA_CASE_ASSIGNEE_NOT_FOUND',
      'El Ejecutivo responsable no existe o está inactivo',
      404
    )
  }

  return result.rows[0]
}

function casePayload(input = {}, defaults = {}) {
  const state = normalizeEnum(
    input.estado,
    'estado',
    CASE_STATES,
    defaults.estado || 'nuevo'
  )
  const solution = normalizeText(
    input.solucion ?? defaults.solucion,
    'solución',
    5000,
    { required: false }
  )

  if (
    (state === 'resuelto' || state === 'cerrado')
    && !solution
  ) {
    throw new CarteraCaseError(
      'CARTERA_CASE_SOLUTION_REQUIRED',
      'La solución es obligatoria para resolver o cerrar el caso'
    )
  }

  return {
    title: normalizeText(
      input.titulo ?? defaults.titulo,
      'título',
      200
    ),
    priority: normalizeEnum(
      input.prioridad,
      'prioridad',
      CASE_PRIORITIES,
      defaults.prioridad || 'media'
    ),
    state,
    comments: normalizeText(
      input.comentarios ?? defaults.comentarios,
      'comentarios',
      5000
    ),
    solution
  }
}

async function createPortfolioCase({
  pool,
  usuario,
  input = {}
}) {
  const actor = resolveCaseActor(usuario)
  const accountId = normalizeBigintId(
    input.cuenta_id,
    'cuenta_id'
  )
  const payload = casePayload(input)

  return withTransaction(pool, async client => {
    const account = await lockAccessibleAccount(
      client,
      actor,
      accountId
    )

    if (account.activa !== true) {
      throw new CarteraCaseError(
        'CARTERA_CASE_ACCOUNT_INACTIVE',
        'No se puede crear un caso en una cuenta cerrada',
        409
      )
    }

    const assigneeId = actor.isExecutive
      ? actor.actorId
      : normalizeUserId(input.asignado_a)

    await requireExecutiveAssignee(
      client,
      actor.empresaId,
      assigneeId
    )

    const created = await client.query(
      `
      INSERT INTO public.cartera_casos
      (
        empresa_id,
        cuenta_id,
        titulo,
        prioridad,
        estado,
        asignado_a,
        comentarios,
        solucion,
        creado_por,
        actualizado_por,
        creado_at,
        actualizado_at,
        resuelto_at,
        cerrado_at
      )
      VALUES
      (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $9,
        clock_timestamp(),
        clock_timestamp(),
        CASE WHEN $5::VARCHAR = 'resuelto' THEN clock_timestamp() END,
        CASE WHEN $5::VARCHAR = 'cerrado' THEN clock_timestamp() END
      )
      RETURNING *
      `,
      [
        actor.empresaId,
        accountId,
        payload.title,
        payload.priority,
        payload.state,
        assigneeId,
        payload.comments,
        payload.solution,
        actor.actorId
      ]
    )

    const record = created.rows[0]

    await client.query(
      `
      INSERT INTO public.cartera_casos_historial
      (
        caso_id,
        empresa_id,
        usuario_id,
        seccion,
        evento,
        valor_nuevo,
        creada_at
      )
      VALUES
      (
        $1, $2, $3,
        'caso',
        'caso_creado',
        $4::JSONB,
        clock_timestamp()
      )
      `,
      [
        record.id,
        actor.empresaId,
        actor.actorId,
        JSON.stringify({
          titulo: payload.title,
          prioridad: payload.priority,
          estado: payload.state,
          asignado_a: assigneeId,
          comentarios: payload.comments,
          solucion: payload.solution
        })
      ]
    )

    await client.query(
      `
      INSERT INTO public.cartera_historial
      (
        cuenta_id,
        usuario_id,
        evento,
        detalle,
        valor_nuevo,
        creada_at
      )
      VALUES
      (
        $1, $2,
        'caso_creado',
        $3,
        $4::JSONB,
        clock_timestamp()
      )
      `,
      [
        accountId,
        actor.actorId,
        `Caso #${record.id}: ${payload.title}`,
        JSON.stringify({
          caso_id: record.id,
          estado: payload.state,
          prioridad: payload.priority,
          asignado_a: assigneeId
        })
      ]
    )

    return { case: record }
  })
}

async function listPortfolioCases({
  pool,
  usuario,
  query = {}
}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new CarteraCaseError(
      'CARTERA_CASE_POOL_INVALID',
      'La conexión de datos no es válida',
      500
    )
  }

  const actor = resolveCaseActor(usuario)
  const values = [actor.empresaId]
  const conditions = ['cc.empresa_id = $1']
  const accountId = query.cuenta
    ? normalizeBigintId(query.cuenta, 'cuenta')
    : null

  if (accountId) {
    values.push(accountId)
    conditions.push(`cc.cuenta_id = $${values.length}`)

    const clientLike = { query: pool.query.bind(pool) }
    await lockAccessibleAccount(clientLike, actor, accountId)
  } else if (actor.isExecutive) {
    values.push(actor.actorId)
    conditions.push(`(
      cc.asignado_a = $${values.length}
      OR cp.modo_distribucion = 'abierta'
    )`)
  }

  if (query.estado) {
    values.push(normalizeEnum(
      query.estado,
      'estado',
      CASE_STATES
    ))
    conditions.push(`cc.estado = $${values.length}`)
  }

  const result = await pool.query(
    `
    SELECT
      cc.id,
      cc.cuenta_id,
      cc.titulo,
      cc.prioridad,
      cc.estado,
      cc.asignado_a,
      u.nombre AS asignado_nombre,
      cc.comentarios,
      cc.solucion,
      cc.version,
      cc.creado_at,
      cc.actualizado_at,
      cc.resuelto_at,
      cc.cerrado_at,
      c.id_campania,
      c.folio,
      s.nombre AS cliente_nombre,
      COALESCE(cp.nombre, c.id_campania) AS campania_nombre,
      COALESCE(cp.modo_distribucion, 'round_robin')
        AS modo_distribucion
    FROM public.cartera_casos cc
    INNER JOIN public.cartera_cuentas c
      ON c.id = cc.cuenta_id
      AND c.empresa_id = cc.empresa_id
    LEFT JOIN public.cartera_snapshots s
      ON s.cuenta_id = c.id
      AND s.importacion_id = c.ultima_importacion_id
    LEFT JOIN public.cartera_campanias cp
      ON cp.empresa_id = c.empresa_id
      AND cp.origen_id = c.origen_id
      AND cp.codigo = c.id_campania
    INNER JOIN public.usuarios u
      ON u.id = cc.asignado_a
      AND u.empresa_id = cc.empresa_id
    WHERE ${conditions.join('\n      AND ')}
    ORDER BY
      CASE cc.prioridad
        WHEN 'urgente' THEN 1
        WHEN 'alta' THEN 2
        WHEN 'media' THEN 3
        ELSE 4
      END,
      cc.actualizado_at DESC,
      cc.id DESC
    LIMIT 100
    `,
    values
  )

  return result.rows
}

async function getPortfolioCase({
  pool,
  usuario,
  caseId
}) {
  const actor = resolveCaseActor(usuario)
  const id = normalizeBigintId(caseId, 'caso')
  const values = [id, actor.empresaId]
  let access = ''

  if (actor.isExecutive) {
    values.push(actor.actorId)
    access = `
      AND (
        cc.asignado_a = $${values.length}
        OR EXISTS (
          SELECT 1
          FROM public.cartera_campanias cp
          WHERE
            cp.empresa_id = c.empresa_id
            AND cp.origen_id = c.origen_id
            AND cp.codigo = c.id_campania
            AND cp.activa = TRUE
            AND cp.modo_distribucion = 'abierta'
        )
      )
    `
  }

  const result = await pool.query(
    `
    SELECT
      cc.*,
      u.nombre AS asignado_nombre,
      c.id_campania,
      c.folio,
      s.nombre AS cliente_nombre
    FROM public.cartera_casos cc
    INNER JOIN public.cartera_cuentas c
      ON c.id = cc.cuenta_id
      AND c.empresa_id = cc.empresa_id
    LEFT JOIN public.cartera_snapshots s
      ON s.cuenta_id = c.id
      AND s.importacion_id = c.ultima_importacion_id
    INNER JOIN public.usuarios u
      ON u.id = cc.asignado_a
    WHERE
      cc.id = $1
      AND cc.empresa_id = $2
      ${access}
    LIMIT 1
    `,
    values
  )

  if (!result.rows[0]) {
    throw new CarteraCaseError(
      'CARTERA_CASE_NOT_FOUND',
      'El caso no existe dentro del alcance',
      404
    )
  }

  const history = await pool.query(
    `
    SELECT
      h.id,
      h.seccion,
      h.evento,
      h.valor_anterior,
      h.valor_nuevo,
      h.creada_at,
      h.usuario_id,
      u.nombre AS usuario_nombre
    FROM public.cartera_casos_historial h
    LEFT JOIN public.usuarios u
      ON u.id = h.usuario_id
    WHERE
      h.caso_id = $1
      AND h.empresa_id = $2
    ORDER BY h.creada_at DESC, h.id DESC
    `,
    [id, actor.empresaId]
  )

  return {
    case: result.rows[0],
    history: history.rows
  }
}

async function updatePortfolioCase({
  pool,
  usuario,
  caseId,
  input = {}
}) {
  const actor = resolveCaseActor(usuario)
  const id = normalizeBigintId(caseId, 'caso')
  const expectedVersion = normalizeVersion(input.version)

  return withTransaction(pool, async client => {
    const values = [id, actor.empresaId]
    let access = ''

    if (actor.isExecutive) {
      values.push(actor.actorId)
      access = `
        AND (
          asignado_a = $${values.length}
          OR EXISTS (
            SELECT 1
            FROM public.cartera_cuentas c
            INNER JOIN public.cartera_campanias cp
              ON cp.empresa_id = c.empresa_id
              AND cp.origen_id = c.origen_id
              AND cp.codigo = c.id_campania
              AND cp.activa = TRUE
            WHERE
              c.id = cartera_casos.cuenta_id
              AND c.empresa_id = cartera_casos.empresa_id
              AND cp.modo_distribucion = 'abierta'
          )
        )
      `
    }

    const locked = await client.query(
      `
      SELECT *
      FROM public.cartera_casos
      WHERE
        id = $1
        AND empresa_id = $2
        ${access}
      FOR UPDATE
      `,
      values
    )

    const current = locked.rows[0]

    if (!current) {
      throw new CarteraCaseError(
        'CARTERA_CASE_NOT_FOUND',
        'El caso no existe dentro del alcance',
        404
      )
    }

    if (current.estado === 'cerrado') {
      throw new CarteraCaseError(
        'CARTERA_CASE_CLOSED_READ_ONLY',
        'El caso está cerrado. Administración debe reabrirlo antes de modificarlo.',
        409
      )
    }

    if (Number(current.version) !== expectedVersion) {
      throw new CarteraCaseError(
        'CARTERA_CASE_VERSION_CONFLICT',
        'Otra persona modificó el caso. Actualícelo antes de guardar.',
        409
      )
    }

    const payload = casePayload(input, current)
    const assigneeId = actor.isAdministrator
      ? normalizeUserId(input.asignado_a ?? current.asignado_a)
      : Number(current.asignado_a)

    if (assigneeId !== Number(current.asignado_a)) {
      await requireExecutiveAssignee(
        client,
        actor.empresaId,
        assigneeId
      )
    }

    const updated = await client.query(
      `
      UPDATE public.cartera_casos
      SET
        titulo = $3,
        prioridad = $4,
        estado = $5,
        asignado_a = $6,
        comentarios = $7,
        solucion = $8,
        actualizado_por = $9,
        actualizado_at = clock_timestamp(),
        version = version + 1,
        resuelto_at = CASE
          WHEN $5::VARCHAR = 'resuelto'
            THEN COALESCE(resuelto_at, clock_timestamp())
          ELSE NULL
        END,
        cerrado_at = CASE
          WHEN $5::VARCHAR = 'cerrado'
            THEN COALESCE(cerrado_at, clock_timestamp())
          ELSE NULL
        END
      WHERE
        id = $1
        AND empresa_id = $2
        AND version = $10
      RETURNING *
      `,
      [
        id,
        actor.empresaId,
        payload.title,
        payload.priority,
        payload.state,
        assigneeId,
        payload.comments,
        payload.solution,
        actor.actorId,
        expectedVersion
      ]
    )

    if (!updated.rows[0]) {
      throw new CarteraCaseError(
        'CARTERA_CASE_VERSION_CONFLICT',
        'Otra persona modificó el caso. Actualícelo antes de guardar.',
        409
      )
    }

    await client.query(
      `
      INSERT INTO public.cartera_casos_historial
      (
        caso_id,
        empresa_id,
        usuario_id,
        seccion,
        evento,
        valor_anterior,
        valor_nuevo,
        creada_at
      )
      VALUES
      (
        $1, $2, $3,
        'caso',
        'caso_actualizado',
        $4::JSONB,
        $5::JSONB,
        clock_timestamp()
      )
      `,
      [
        id,
        actor.empresaId,
        actor.actorId,
        JSON.stringify({
          titulo: current.titulo,
          prioridad: current.prioridad,
          estado: current.estado,
          asignado_a: current.asignado_a,
          comentarios: current.comentarios,
          solucion: current.solucion,
          version: current.version
        }),
        JSON.stringify({
          titulo: payload.title,
          prioridad: payload.priority,
          estado: payload.state,
          asignado_a: assigneeId,
          comentarios: payload.comments,
          solucion: payload.solution,
          version: updated.rows[0].version
        })
      ]
    )

    await client.query(
      `
      INSERT INTO public.cartera_historial
      (
        cuenta_id,
        usuario_id,
        evento,
        detalle,
        valor_anterior,
        valor_nuevo,
        creada_at
      )
      VALUES
      (
        $1, $2,
        'caso_actualizado',
        $3,
        $4::JSONB,
        $5::JSONB,
        clock_timestamp()
      )
      `,
      [
        current.cuenta_id,
        actor.actorId,
        `Caso #${id}: ${payload.title}`,
        JSON.stringify({
          caso_id: id,
          estado: current.estado,
          prioridad: current.prioridad,
          asignado_a: current.asignado_a,
          version: current.version
        }),
        JSON.stringify({
          caso_id: id,
          estado: payload.state,
          prioridad: payload.priority,
          asignado_a: assigneeId,
          version: updated.rows[0].version
        })
      ]
    )

    return { case: updated.rows[0] }
  })
}

async function reopenPortfolioCase({
  pool,
  usuario,
  caseId,
  input = {}
}) {
  const actor = resolveCaseActor(usuario)

  if (!actor.isAdministrator) {
    throw new CarteraCaseError(
      'CARTERA_CASE_REOPEN_ADMIN_REQUIRED',
      'Solo Administración puede reabrir un caso cerrado',
      403
    )
  }

  const id = normalizeBigintId(caseId, 'caso')
  const expectedVersion = normalizeVersion(input.version)
  const reason = normalizeText(
    input.motivo,
    'motivo de reapertura',
    1000
  )

  return withTransaction(pool, async client => {
    const locked = await client.query(
      `
      SELECT *
      FROM public.cartera_casos
      WHERE
        id = $1
        AND empresa_id = $2
      FOR UPDATE
      `,
      [id, actor.empresaId]
    )

    const current = locked.rows[0]

    if (!current) {
      throw new CarteraCaseError(
        'CARTERA_CASE_NOT_FOUND',
        'El caso no existe dentro del alcance',
        404
      )
    }

    if (current.estado !== 'cerrado') {
      throw new CarteraCaseError(
        'CARTERA_CASE_NOT_CLOSED',
        'Solo puede reabrirse un caso cerrado',
        409
      )
    }

    if (Number(current.version) !== expectedVersion) {
      throw new CarteraCaseError(
        'CARTERA_CASE_VERSION_CONFLICT',
        'Otra persona modificó el caso. Actualícelo antes de reabrir.',
        409
      )
    }

    const reopened = await client.query(
      `
      UPDATE public.cartera_casos
      SET
        estado = 'en_proceso',
        actualizado_por = $3,
        actualizado_at = clock_timestamp(),
        version = version + 1,
        resuelto_at = NULL,
        cerrado_at = NULL
      WHERE
        id = $1
        AND empresa_id = $2
        AND version = $4
      RETURNING *
      `,
      [
        id,
        actor.empresaId,
        actor.actorId,
        expectedVersion
      ]
    )

    if (!reopened.rows[0]) {
      throw new CarteraCaseError(
        'CARTERA_CASE_VERSION_CONFLICT',
        'Otra persona modificó el caso. Actualícelo antes de reabrir.',
        409
      )
    }

    const record = reopened.rows[0]

    await client.query(
      `
      INSERT INTO public.cartera_casos_historial
      (
        caso_id,
        empresa_id,
        usuario_id,
        seccion,
        evento,
        valor_anterior,
        valor_nuevo,
        creada_at
      )
      VALUES
      (
        $1, $2, $3,
        'estado',
        'caso_reabierto',
        $4::JSONB,
        $5::JSONB,
        clock_timestamp()
      )
      `,
      [
        id,
        actor.empresaId,
        actor.actorId,
        JSON.stringify({
          estado: current.estado,
          cerrado_at: current.cerrado_at,
          version: current.version
        }),
        JSON.stringify({
          estado: record.estado,
          motivo: reason,
          version: record.version
        })
      ]
    )

    await client.query(
      `
      INSERT INTO public.cartera_historial
      (
        cuenta_id,
        usuario_id,
        evento,
        detalle,
        valor_anterior,
        valor_nuevo,
        creada_at
      )
      VALUES
      (
        $1, $2,
        'caso_reabierto',
        $3,
        $4::JSONB,
        $5::JSONB,
        clock_timestamp()
      )
      `,
      [
        current.cuenta_id,
        actor.actorId,
        `Caso #${id} reabierto: ${reason}`,
        JSON.stringify({
          caso_id: id,
          estado: current.estado,
          version: current.version
        }),
        JSON.stringify({
          caso_id: id,
          estado: record.estado,
          motivo: reason,
          version: record.version
        })
      ]
    )

    return { case: record }
  })
}

module.exports = {
  CASE_PRIORITIES,
  CASE_STATES,
  CarteraCaseError,
  casePayload,
  createPortfolioCase,
  getPortfolioCase,
  listPortfolioCases,
  normalizeVersion,
  reopenPortfolioCase,
  resolveCaseActor,
  updatePortfolioCase
}
