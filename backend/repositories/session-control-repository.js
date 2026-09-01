'use strict'

const { ROLES } = require('../config/constants')

const SESSION_ONLINE_SECONDS = 150
const SESSION_HISTORY_HOURS = 24
const SESSION_LIST_LIMIT = 250
const UUID_PATTERN = (
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
)

class SessionControlError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'SessionControlError'
    this.code = code
    this.status = status
  }
}

function positiveInteger(value, field) {
  const text = String(value ?? '').trim()

  if (!/^[1-9]\d*$/.test(text)) {
    throw new SessionControlError(
      'SESSION_SCOPE_INVALID',
      `${field} no es válido`,
      401
    )
  }

  const parsed = Number(text)

  if (!Number.isSafeInteger(parsed) || parsed > 2147483647) {
    throw new SessionControlError(
      'SESSION_SCOPE_INVALID',
      `${field} no es válido`,
      401
    )
  }

  return parsed
}

function normalizeSessionId(value) {
  const id = String(value ?? '').trim()

  if (!UUID_PATTERN.test(id)) {
    throw new SessionControlError(
      'SESSION_ID_INVALID',
      'La sesión no es válida',
      401
    )
  }

  return id.toLowerCase()
}

function normalizeRequestText(value, maximum) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, maximum) : null
}

function normalizeCloseReason(value) {
  const reason = normalizeRequestText(value, 255)
  return reason || 'Cierre remoto por administración'
}

function resolveSessionScope(usuario, { admin = false } = {}) {
  if (!usuario || typeof usuario !== 'object') {
    throw new SessionControlError(
      'SESSION_REQUIRED',
      'La sesión es obligatoria',
      401
    )
  }

  const userId = positiveInteger(usuario.id, 'El usuario')
  const companyId = positiveInteger(
    usuario.empresa_id,
    'La empresa'
  )

  if (
    admin
    && usuario.rol !== ROLES.ADMIN
    && usuario.rol !== ROLES.SUPER_ADMIN
  ) {
    throw new SessionControlError(
      'SESSION_ADMIN_FORBIDDEN',
      'No tiene permisos para administrar sesiones',
      403
    )
  }

  return {
    userId,
    companyId,
    role: usuario.rol,
    sessionId: usuario.session_id
      ? normalizeSessionId(usuario.session_id)
      : null
  }
}

async function createSession({
  pool,
  usuario,
  sessionId,
  expiresAt,
  ipAddress,
  userAgent
}) {
  const scope = resolveSessionScope(usuario)
  const id = normalizeSessionId(sessionId)
  const expiration = expiresAt instanceof Date
    ? expiresAt
    : new Date(expiresAt)

  if (Number.isNaN(expiration.getTime())) {
    throw new SessionControlError(
      'SESSION_EXPIRATION_INVALID',
      'La caducidad de la sesión no es válida'
    )
  }

  await pool.query(
    `
    INSERT INTO public.crm_sesiones
    (
      id,
      empresa_id,
      usuario_id,
      direccion_ip,
      agente_usuario,
      expira_at
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      id,
      scope.companyId,
      scope.userId,
      normalizeRequestText(ipAddress, 64),
      normalizeRequestText(userAgent, 1000),
      expiration
    ]
  )

  return id
}

async function validateSession({
  pool,
  usuario,
  sessionId
}) {
  const scope = resolveSessionScope(usuario)
  const id = normalizeSessionId(sessionId)
  const result = await pool.query(
    `
    WITH sesion_valida AS MATERIALIZED (
      SELECT
        s.id,
        s.ultima_actividad_at
      FROM public.crm_sesiones s
      INNER JOIN public.usuarios u
        ON u.id = s.usuario_id
        AND u.empresa_id = s.empresa_id
      WHERE
        s.id = $1
        AND s.usuario_id = $2
        AND s.empresa_id = $3
        AND s.cerrada_at IS NULL
        AND s.expira_at > NOW()
        AND u.activo = TRUE
        AND u.rol = $4
    ), actividad_actualizada AS (
      UPDATE public.crm_sesiones s
      SET ultima_actividad_at = NOW()
      FROM sesion_valida v
      WHERE
        s.id = v.id
        AND v.ultima_actividad_at
          < NOW() - INTERVAL '30 seconds'
      RETURNING s.id
    )
    SELECT id
    FROM sesion_valida
    `,
    [
      id,
      scope.userId,
      scope.companyId,
      scope.role
    ]
  )

  if (!result.rows[0]) {
    throw new SessionControlError(
      'SESSION_INACTIVE',
      'La sesión terminó o fue cerrada por administración',
      401
    )
  }

  return true
}

async function listSessions({ pool, usuario }) {
  const scope = resolveSessionScope(usuario, { admin: true })
  const result = await pool.query(
    `
    SELECT
      s.id,
      s.usuario_id,
      u.nombre AS usuario_nombre,
      u.email AS usuario_email,
      u.rol AS usuario_rol,
      s.direccion_ip,
      s.agente_usuario,
      s.iniciada_at,
      s.ultima_actividad_at,
      s.expira_at,
      s.cerrada_at,
      s.cierre_motivo,
      COALESCE(c.nombre, '') AS cerrada_por_nombre,
      (
        s.cerrada_at IS NULL
        AND s.expira_at > NOW()
      ) AS activa,
      (
        s.cerrada_at IS NULL
        AND s.expira_at > NOW()
        AND s.ultima_actividad_at
          >= NOW() - ($2 * INTERVAL '1 second')
      ) AS en_linea
    FROM public.crm_sesiones s
    INNER JOIN public.usuarios u
      ON u.id = s.usuario_id
      AND u.empresa_id = s.empresa_id
    LEFT JOIN public.usuarios c
      ON c.id = s.cerrada_por
    WHERE
      s.empresa_id = $1
      AND (
        (
          s.cerrada_at IS NULL
          AND s.expira_at > NOW()
        )
        OR COALESCE(s.cerrada_at, s.expira_at)
          >= NOW() - ($3 * INTERVAL '1 hour')
      )
    ORDER BY
      (s.cerrada_at IS NULL) DESC,
      s.ultima_actividad_at DESC,
      s.id
    LIMIT $4
    `,
    [
      scope.companyId,
      SESSION_ONLINE_SECONDS,
      SESSION_HISTORY_HOURS,
      SESSION_LIST_LIMIT
    ]
  )

  return result.rows.map(row => ({
    id: String(row.id),
    userId: String(row.usuario_id),
    userName: row.usuario_nombre,
    userEmail: row.usuario_email,
    userRole: row.usuario_rol,
    ipAddress: row.direccion_ip || null,
    userAgent: row.agente_usuario || null,
    startedAt: row.iniciada_at,
    lastActivityAt: row.ultima_actividad_at,
    expiresAt: row.expira_at,
    closedAt: row.cerrada_at,
    closeReason: row.cierre_motivo || null,
    closedBy: row.cerrada_por_nombre || null,
    active: row.activa === true,
    online: row.en_linea === true,
    current: scope.sessionId === String(row.id).toLowerCase()
  }))
}

async function closeSession({
  pool,
  usuario,
  sessionId,
  reason
}) {
  const scope = resolveSessionScope(usuario, { admin: true })
  const id = normalizeSessionId(sessionId)

  if (scope.sessionId === id) {
    throw new SessionControlError(
      'SESSION_SELF_CLOSE_FORBIDDEN',
      'Use Cerrar sesión para finalizar su sesión actual',
      403
    )
  }

  const result = await pool.query(
    `
    UPDATE public.crm_sesiones s
    SET
      cerrada_at = NOW(),
      cerrada_por = $1,
      cierre_motivo = $2
    FROM public.usuarios u
    WHERE
      s.id = $3
      AND s.empresa_id = $4
      AND s.cerrada_at IS NULL
      AND s.expira_at > NOW()
      AND u.id = s.usuario_id
      AND u.empresa_id = s.empresa_id
      AND (
        u.rol <> $5
        OR $6 = $5
      )
    RETURNING s.id, s.usuario_id, s.cerrada_at
    `,
    [
      scope.userId,
      normalizeCloseReason(reason),
      id,
      scope.companyId,
      ROLES.SUPER_ADMIN,
      scope.role
    ]
  )

  if (!result.rows[0]) {
    throw new SessionControlError(
      'SESSION_NOT_FOUND',
      'La sesión no existe, ya terminó o está protegida',
      404
    )
  }

  return {
    success: true,
    sessionId: String(result.rows[0].id),
    userId: String(result.rows[0].usuario_id),
    closedAt: result.rows[0].cerrada_at
  }
}

async function closeOwnSession({ pool, usuario }) {
  const scope = resolveSessionScope(usuario)

  if (!scope.sessionId) {
    throw new SessionControlError(
      'SESSION_ID_INVALID',
      'La sesión no es válida',
      401
    )
  }

  await pool.query(
    `
    UPDATE public.crm_sesiones
    SET
      cerrada_at = NOW(),
      cerrada_por = $1,
      cierre_motivo = 'Cierre de sesión del usuario'
    WHERE
      id = $2
      AND usuario_id = $1
      AND empresa_id = $3
      AND cerrada_at IS NULL
    `,
    [scope.userId, scope.sessionId, scope.companyId]
  )

  return { success: true }
}

module.exports = {
  SESSION_HISTORY_HOURS,
  SESSION_LIST_LIMIT,
  SESSION_ONLINE_SECONDS,
  SessionControlError,
  closeOwnSession,
  closeSession,
  createSession,
  listSessions,
  normalizeCloseReason,
  normalizeSessionId,
  resolveSessionScope,
  validateSession
}
