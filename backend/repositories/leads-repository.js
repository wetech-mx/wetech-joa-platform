'use strict'

const {
  ROLES,
  ESTADOS_LEAD,
  PRIORIDADES
} = require('../config/constants')

const VALID_ROLES = new Set(Object.values(ROLES))
const VALID_STATES = new Set(Object.values(ESTADOS_LEAD))
const VALID_PRIORITIES = new Set(Object.values(PRIORIDADES))

class LeadSecurityError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'LeadSecurityError'
    this.code = code
    this.status = status
  }
}

function positiveInteger(value, field) {
  const text = String(value ?? '').trim()

  if (!/^[1-9]\d*$/.test(text)) {
    throw new LeadSecurityError(
      'LEAD_ID_INVALID',
      `${field} no es válido`
    )
  }

  const parsed = Number(text)

  if (!Number.isSafeInteger(parsed) || parsed > 2147483647) {
    throw new LeadSecurityError(
      'LEAD_ID_INVALID',
      `${field} no es válido`
    )
  }

  return parsed
}

function resolveLeadScope(usuario) {
  if (!usuario || typeof usuario !== 'object') {
    throw new LeadSecurityError(
      'LEAD_SESSION_REQUIRED',
      'La sesión es obligatoria',
      401
    )
  }

  const userId = positiveInteger(
    usuario.id,
    'El usuario'
  )
  const companyId = positiveInteger(
    usuario.empresa_id,
    'La empresa'
  )

  if (!VALID_ROLES.has(usuario.rol)) {
    throw new LeadSecurityError(
      'LEAD_ROLE_FORBIDDEN',
      'El rol no tiene acceso a leads',
      403
    )
  }

  return {
    userId,
    companyId,
    role: usuario.rol,
    isExecutive: usuario.rol === ROLES.EJECUTIVO
  }
}

function leadScopeSql(scope, alias, firstParameter) {
  const values = [scope.companyId]
  let sql = `${alias}.empresa_id = $${firstParameter}`

  if (scope.isExecutive) {
    values.push(scope.userId)
    sql += `\n      AND ${alias}.usuario_id = $${firstParameter + 1}`
  }

  return {
    sql,
    values
  }
}

function normalizeState(value) {
  const state = String(value ?? '').trim()

  if (!VALID_STATES.has(state)) {
    throw new LeadSecurityError(
      'LEAD_STATE_INVALID',
      'El estado del lead no es válido'
    )
  }

  return state
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const [year, month, day] = value
    .split('-')
    .map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  )
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const date = String(value).trim()

  if (!isValidIsoDate(date)) {
    throw new LeadSecurityError(
      'LEAD_DATE_INVALID',
      'La fecha de próximo contacto no es válida'
    )
  }

  return date
}

function normalizeNotes(value) {
  const notes = String(value ?? '').trim()

  if (notes.length > 5000) {
    throw new LeadSecurityError(
      'LEAD_NOTES_TOO_LONG',
      'Las notas exceden el máximo permitido'
    )
  }

  return notes
}

function requiredText(value, field, maxLength) {
  const text = String(value ?? '').trim()

  if (!text) {
    throw new LeadSecurityError(
      'LEAD_IMPORT_VALUE_REQUIRED',
      `${field} es obligatorio`
    )
  }

  if (text.length > maxLength) {
    throw new LeadSecurityError(
      'LEAD_IMPORT_VALUE_TOO_LONG',
      `${field} excede el máximo permitido`
    )
  }

  return text
}

function optionalText(value, maxLength) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, maxLength) : ''
}

async function listLeads({ pool, usuario }) {
  const scope = resolveLeadScope(usuario)
  const access = leadScopeSql(scope, 'l', 1)

  const result = await pool.query(
    `
    SELECT
      l.*,
      u.nombre AS usuario_nombre
    FROM public.leads l
    LEFT JOIN public.usuarios u
      ON u.id = l.usuario_id
      AND u.empresa_id = l.empresa_id
    WHERE
      ${access.sql}
      AND l.activo = TRUE
    ORDER BY l.id DESC
    `,
    access.values
  )

  return result.rows
}

async function listActiveExecutives({ pool, usuario }) {
  const scope = resolveLeadScope(usuario)
  const result = await pool.query(
    `
    SELECT
      id,
      nombre
    FROM public.usuarios
    WHERE
      empresa_id = $1
      AND rol = $2
      AND activo = TRUE
    ORDER BY nombre, id
    `,
    [scope.companyId, ROLES.EJECUTIVO]
  )

  return result.rows
}

async function listAlerts({ pool, usuario }) {
  const scope = resolveLeadScope(usuario)
  const access = leadScopeSql(scope, 'l', 1)
  const commonSql = `
    SELECT l.*
    FROM public.leads l
    WHERE
      ${access.sql}
      AND l.activo = TRUE
      AND l.proximo_contacto`

  const [expired, today] = await Promise.all([
    pool.query(
      `${commonSql} < CURRENT_DATE
       ORDER BY l.proximo_contacto, l.id`,
      access.values
    ),
    pool.query(
      `${commonSql} = CURRENT_DATE
       ORDER BY l.proximo_contacto, l.id`,
      access.values
    )
  ])

  return {
    vencidos: expired.rows,
    hoy: today.rows
  }
}

async function getLeadHistory({
  pool,
  usuario,
  leadId
}) {
  const scope = resolveLeadScope(usuario)
  const id = positiveInteger(leadId, 'El lead')
  const access = leadScopeSql(scope, 'l', 2)
  const found = await pool.query(
    `
    SELECT l.id
    FROM public.leads l
    WHERE
      l.id = $1
      AND ${access.sql}
      AND l.activo = TRUE
    `,
    [id, ...access.values]
  )

  if (!found.rows[0]) {
    throw new LeadSecurityError(
      'LEAD_NOT_FOUND',
      'El lead no existe o no pertenece a su alcance',
      404
    )
  }

  const history = await pool.query(
    `
    SELECT
      h.id,
      h.accion,
      h.detalle,
      h.created_at,
      u.nombre AS usuario
    FROM public.historial_leads h
    LEFT JOIN public.usuarios u
      ON u.id = h.usuario_id
      AND u.empresa_id = $2
    WHERE h.lead_id = $1
    ORDER BY h.created_at DESC, h.id DESC
    `,
    [id, scope.companyId]
  )

  return history.rows
}

async function updateLeadField({
  pool,
  usuario,
  leadId,
  column,
  value,
  action,
  detail
}) {
  const scope = resolveLeadScope(usuario)
  const id = positiveInteger(leadId, 'El lead')
  const access = leadScopeSql(scope, 'l', 3)
  const values = [value, id, ...access.values, scope.userId, action, detail]
  const userIndex = 3 + access.values.length
  const actionIndex = userIndex + 1
  const detailIndex = actionIndex + 1
  const result = await pool.query(
    `
    WITH updated AS (
      UPDATE public.leads l
      SET ${column} = $1
      WHERE
        l.id = $2
        AND ${access.sql}
        AND l.activo = TRUE
      RETURNING l.id
    )
    INSERT INTO public.historial_leads
    (
      lead_id,
      usuario_id,
      accion,
      detalle
    )
    SELECT
      id,
      $${userIndex},
      $${actionIndex},
      $${detailIndex}
    FROM updated
    RETURNING lead_id
    `,
    values
  )

  if (!result.rows[0]) {
    throw new LeadSecurityError(
      'LEAD_NOT_FOUND',
      'El lead no existe o no pertenece a su alcance',
      404
    )
  }

  return {
    success: true
  }
}

async function updateLeadState({
  pool,
  usuario,
  leadId,
  estado
}) {
  const state = normalizeState(estado)

  return updateLeadField({
    pool,
    usuario,
    leadId,
    column: 'estado',
    value: state,
    action: 'Cambio de estado',
    detail: `Estado cambiado a: ${state}`
  })
}

async function updateLeadDate({
  pool,
  usuario,
  leadId,
  proximoContacto
}) {
  const date = normalizeDate(proximoContacto)

  return updateLeadField({
    pool,
    usuario,
    leadId,
    column: 'proximo_contacto',
    value: date,
    action: 'Cambio de fecha',
    detail: `Nueva fecha: ${date || 'Sin fecha'}`
  })
}

async function updateLeadNotes({
  pool,
  usuario,
  leadId,
  notas
}) {
  const notes = normalizeNotes(notas)

  return updateLeadField({
    pool,
    usuario,
    leadId,
    column: 'notas',
    value: notes,
    action: 'Nota actualizada',
    detail: notes
  })
}

async function assignLead({
  pool,
  usuario,
  leadId,
  usuarioId
}) {
  const scope = resolveLeadScope(usuario)

  if (scope.isExecutive) {
    throw new LeadSecurityError(
      'LEAD_ASSIGN_FORBIDDEN',
      'No tiene permisos para asignar leads',
      403
    )
  }

  const id = positiveInteger(leadId, 'El lead')
  const executiveId = positiveInteger(
    usuarioId,
    'El ejecutivo'
  )
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const executive = await client.query(
      `
      SELECT id, nombre
      FROM public.usuarios
      WHERE
        id = $1
        AND empresa_id = $2
        AND rol = $3
        AND activo = TRUE
      FOR UPDATE
      `,
      [executiveId, scope.companyId, ROLES.EJECUTIVO]
    )

    if (!executive.rows[0]) {
      throw new LeadSecurityError(
        'LEAD_EXECUTIVE_INVALID',
        'El ejecutivo no existe o no pertenece a la empresa',
        400
      )
    }

    const updated = await client.query(
      `
      UPDATE public.leads
      SET usuario_id = $1
      WHERE
        id = $2
        AND empresa_id = $3
        AND activo = TRUE
      RETURNING id
      `,
      [executiveId, id, scope.companyId]
    )

    if (!updated.rows[0]) {
      throw new LeadSecurityError(
        'LEAD_NOT_FOUND',
        'El lead no existe o no pertenece a su alcance',
        404
      )
    }

    await client.query(
      `
      INSERT INTO public.historial_leads
      (
        lead_id,
        usuario_id,
        accion,
        detalle
      )
      VALUES ($1, $2, $3, $4)
      `,
      [
        id,
        scope.userId,
        'Asignación',
        `Asignado a: ${executive.rows[0].nombre}`
      ]
    )

    await client.query('COMMIT')

    return {
      success: true
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function normalizeImportRow(row) {
  const name = requiredText(row.nombre, 'nombre', 255)
  const email = optionalText(row.email, 320)
  const phone = optionalText(row.telefono, 100)

  if (!email || !phone) {
    return null
  }

  const priority = optionalText(row.prioridad, 50) || PRIORIDADES.MEDIA
  const state = optionalText(row.estado, 50) || ESTADOS_LEAD.NUEVO

  if (!VALID_PRIORITIES.has(priority)) {
    throw new LeadSecurityError(
      'LEAD_IMPORT_PRIORITY_INVALID',
      'La prioridad importada no es válida'
    )
  }

  if (!VALID_STATES.has(state)) {
    throw new LeadSecurityError(
      'LEAD_IMPORT_STATE_INVALID',
      'El estado importado no es válido'
    )
  }

  return {
    name,
    company: optionalText(row.empresa, 255),
    phone,
    email,
    priority,
    need: optionalText(row.necesidad, 5000),
    state
  }
}

async function importLeadRows({
  pool,
  usuario,
  rows
}) {
  const scope = resolveLeadScope(usuario)

  if (scope.isExecutive) {
    throw new LeadSecurityError(
      'LEAD_IMPORT_FORBIDDEN',
      'No tiene permisos para importar leads',
      403
    )
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new LeadSecurityError(
      'LEAD_IMPORT_EMPTY',
      'El archivo está vacío'
    )
  }

  const client = await pool.connect()
  let imported = 0
  let duplicates = 0
  let omitted = 0

  try {
    await client.query('BEGIN')

    for (const row of rows) {
      const lead = normalizeImportRow(row)

      if (!lead) {
        omitted++
        continue
      }

      const existing = await client.query(
        `
        SELECT id
        FROM public.leads
        WHERE
          empresa_id = $1
          AND LOWER(TRIM(email)) = LOWER(TRIM($2))
          AND telefono = $3
          AND activo = TRUE
        LIMIT 1
        `,
        [scope.companyId, lead.email, lead.phone]
      )

      if (existing.rows[0]) {
        duplicates++
        continue
      }

      await client.query(
        `
        INSERT INTO public.leads
        (
          nombre,
          empresa,
          telefono,
          email,
          prioridad,
          necesidad,
          estado,
          empresa_id,
          activo
        )
        VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
        `,
        [
          lead.name,
          lead.company,
          lead.phone,
          lead.email,
          lead.priority,
          lead.need,
          lead.state,
          scope.companyId
        ]
      )

      imported++
    }

    await client.query('COMMIT')

    return {
      success: true,
      importados: imported,
      duplicados: duplicates,
      omitidos: omitted
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

module.exports = {
  LeadSecurityError,
  assignLead,
  getLeadHistory,
  importLeadRows,
  isValidIsoDate,
  listActiveExecutives,
  listAlerts,
  listLeads,
  normalizeDate,
  normalizeState,
  positiveInteger,
  resolveLeadScope,
  updateLeadDate,
  updateLeadNotes,
  updateLeadState
}
