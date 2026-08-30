'use strict'

const {
  ROLES
} = require('../config/constants')

const MANAGEABLE_ROLES = new Set([
  ROLES.ADMIN,
  ROLES.EJECUTIVO
])

class UserSecurityError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'UserSecurityError'
    this.code = code
    this.status = status
  }
}

function positiveInteger(value, field) {
  const text = String(value ?? '').trim()

  if (!/^[1-9]\d*$/.test(text)) {
    throw new UserSecurityError(
      'USER_ID_INVALID',
      `${field} no es válido`
    )
  }

  const parsed = Number(text)

  if (!Number.isSafeInteger(parsed) || parsed > 2147483647) {
    throw new UserSecurityError(
      'USER_ID_INVALID',
      `${field} no es válido`
    )
  }

  return parsed
}

function resolveUserScope(usuario) {
  if (!usuario || typeof usuario !== 'object') {
    throw new UserSecurityError(
      'USER_SESSION_REQUIRED',
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
    usuario.rol !== ROLES.ADMIN
    && usuario.rol !== ROLES.SUPER_ADMIN
  ) {
    throw new UserSecurityError(
      'USER_MANAGEMENT_FORBIDDEN',
      'No tiene permisos para administrar usuarios',
      403
    )
  }

  return {
    userId,
    companyId
  }
}

function normalizeName(value) {
  const name = String(value ?? '').trim()

  if (!name || name.length > 255) {
    throw new UserSecurityError(
      'USER_NAME_INVALID',
      'El nombre del usuario no es válido'
    )
  }

  return name
}

function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase()

  if (
    !email
    || email.length > 320
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new UserSecurityError(
      'USER_EMAIL_INVALID',
      'El correo del usuario no es válido'
    )
  }

  return email
}

function normalizeRole(value) {
  const role = String(value ?? '').trim()

  if (!MANAGEABLE_ROLES.has(role)) {
    throw new UserSecurityError(
      'USER_ROLE_INVALID',
      'El rol del usuario no es válido'
    )
  }

  return role
}

function normalizePassword(value) {
  if (
    typeof value !== 'string'
    || value.length < 10
    || value.length > 128
  ) {
    throw new UserSecurityError(
      'USER_PASSWORD_INVALID',
      'La contraseña debe tener entre 10 y 128 caracteres'
    )
  }

  return value
}

function normalizeUserInput(body, { requirePassword = false } = {}) {
  const normalized = {
    name: normalizeName(body?.nombre),
    email: normalizeEmail(body?.email),
    role: normalizeRole(body?.rol)
  }

  if (requirePassword) {
    normalized.password = normalizePassword(body?.password)
  }

  return normalized
}

function translateDatabaseError(error) {
  if (error?.code === '23505') {
    throw new UserSecurityError(
      'USER_EMAIL_DUPLICATE',
      'Ya existe un usuario con ese correo',
      409
    )
  }

  throw error
}

async function listUsers({ pool, usuario }) {
  const scope = resolveUserScope(usuario)
  const result = await pool.query(
    `
    SELECT
      id,
      nombre,
      email,
      rol,
      activo
    FROM public.usuarios
    WHERE empresa_id = $1
    ORDER BY activo DESC, nombre, id
    `,
    [scope.companyId]
  )

  return result.rows
}

async function createUser({
  pool,
  usuario,
  input,
  passwordHash
}) {
  const scope = resolveUserScope(usuario)

  try {
    const result = await pool.query(
      `
      INSERT INTO public.usuarios
      (
        nombre,
        email,
        password_hash,
        rol,
        activo,
        empresa_id
      )
      VALUES ($1, $2, $3, $4, TRUE, $5)
      RETURNING id, nombre, email, rol, activo
      `,
      [
        input.name,
        input.email,
        passwordHash,
        input.role,
        scope.companyId
      ]
    )

    return result.rows[0]
  } catch (error) {
    translateDatabaseError(error)
  }
}

async function updateUser({
  pool,
  usuario,
  userId,
  input
}) {
  const scope = resolveUserScope(usuario)
  const id = positiveInteger(userId, 'El usuario')

  try {
    const result = await pool.query(
      `
      UPDATE public.usuarios
      SET
        nombre = $1,
        email = $2,
        rol = $3
      WHERE
        id = $4
        AND empresa_id = $5
        AND rol <> $6
      RETURNING id, nombre, email, rol, activo
      `,
      [
        input.name,
        input.email,
        input.role,
        id,
        scope.companyId,
        ROLES.SUPER_ADMIN
      ]
    )

    if (!result.rows[0]) {
      throw new UserSecurityError(
        'USER_NOT_FOUND',
        'El usuario no existe, no pertenece a la empresa o está protegido',
        404
      )
    }

    return result.rows[0]
  } catch (error) {
    if (error instanceof UserSecurityError) {
      throw error
    }

    translateDatabaseError(error)
  }
}

async function deactivateUser({
  pool,
  usuario,
  userId
}) {
  const scope = resolveUserScope(usuario)
  const id = positiveInteger(userId, 'El usuario')

  if (id === scope.userId) {
    throw new UserSecurityError(
      'USER_SELF_DEACTIVATION_FORBIDDEN',
      'No puede desactivar su propia cuenta',
      403
    )
  }

  const result = await pool.query(
    `
    UPDATE public.usuarios
    SET activo = FALSE
    WHERE
      id = $1
      AND empresa_id = $2
      AND rol <> $3
      AND activo = TRUE
    RETURNING id
    `,
    [id, scope.companyId, ROLES.SUPER_ADMIN]
  )

  if (!result.rows[0]) {
    throw new UserSecurityError(
      'USER_NOT_FOUND',
      'El usuario no existe, no pertenece a la empresa o está protegido',
      404
    )
  }

  return {
    success: true
  }
}

async function resetUserPassword({
  pool,
  usuario,
  userId,
  passwordHash
}) {
  const scope = resolveUserScope(usuario)
  const id = positiveInteger(userId, 'El usuario')

  const result = await pool.query(
    `
    UPDATE public.usuarios
    SET password_hash = $1
    WHERE
      id = $2
      AND empresa_id = $3
      AND rol <> $4
      AND activo = TRUE
    RETURNING id, nombre, email, rol, activo
    `,
    [
      passwordHash,
      id,
      scope.companyId,
      ROLES.SUPER_ADMIN
    ]
  )

  if (!result.rows[0]) {
    throw new UserSecurityError(
      'USER_NOT_FOUND',
      'El usuario no existe, está inactivo, no pertenece a la empresa o está protegido',
      404
    )
  }

  return result.rows[0]
}

module.exports = {
  MANAGEABLE_ROLES,
  UserSecurityError,
  createUser,
  deactivateUser,
  listUsers,
  normalizeEmail,
  normalizePassword,
  normalizeRole,
  normalizeUserInput,
  positiveInteger,
  resetUserPassword,
  resolveUserScope,
  updateUser
}
