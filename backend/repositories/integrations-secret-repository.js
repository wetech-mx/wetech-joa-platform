'use strict'

const MAX_BIGINT = 9223372036854775807n
const REFERENCE_PATTERN = /^(servidor|archivo_seguro|entorno):[a-z0-9]+(?:_[a-z0-9]+)*$/

class IntegrationSecretReferenceError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'IntegrationSecretReferenceError'
    this.code = code
    this.status = status
  }
}

function normalizeBigint(value, field) {
  const normalized = String(value ?? '').trim()

  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new IntegrationSecretReferenceError(
      'INTEGRATION_SECRET_ID_INVALID',
      `${field} debe ser un entero positivo`
    )
  }

  if (BigInt(normalized) > MAX_BIGINT) {
    throw new IntegrationSecretReferenceError(
      'INTEGRATION_SECRET_ID_INVALID',
      `${field} está fuera del rango permitido`
    )
  }

  return normalized
}

function normalizeSecretReference(value) {
  const normalized = String(value ?? '').trim()

  if (
    normalized.length < 4
    || normalized.length > 255
    || !REFERENCE_PATTERN.test(normalized)
  ) {
    throw new IntegrationSecretReferenceError(
      'INTEGRATION_SECRET_REFERENCE_INVALID',
      'La referencia debe usar un esquema y alias permitidos'
    )
  }

  return normalized
}

function validatePool(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new IntegrationSecretReferenceError(
      'INTEGRATION_SECRET_POOL_INVALID',
      'La conexión PostgreSQL no es válida'
    )
  }
}

async function findIntegrationTarget({
  pool,
  empresaId,
  integrationId
}) {
  validatePool(pool)

  const companyId = normalizeBigint(
    empresaId,
    'empresa_id'
  )
  const id = normalizeBigint(
    integrationId,
    'integracion_id'
  )

  const result = await pool.query(
    `
    SELECT
      id::TEXT AS id,
      codigo,
      nombre,
      activo,
      (referencia_secreto IS NOT NULL)
        AS secreto_configurado
    FROM public.crm_integraciones
    WHERE empresa_id = $1::BIGINT
      AND id = $2::BIGINT
    `,
    [companyId, id]
  )

  if (!result.rows[0]) {
    throw new IntegrationSecretReferenceError(
      'INTEGRATION_SECRET_TARGET_NOT_FOUND',
      'La integración no existe dentro de la empresa',
      404
    )
  }

  return result.rows[0]
}

async function configureSecretReference({
  pool,
  empresaId,
  integrationId,
  reference
}) {
  validatePool(pool)

  const companyId = normalizeBigint(
    empresaId,
    'empresa_id'
  )
  const id = normalizeBigint(
    integrationId,
    'integracion_id'
  )
  const normalizedReference = normalizeSecretReference(
    reference
  )

  const result = await pool.query(
    `
    UPDATE public.crm_integraciones
    SET
      referencia_secreto = $3,
      actualizado_at = NOW()
    WHERE empresa_id = $1::BIGINT
      AND id = $2::BIGINT
    RETURNING
      id::TEXT AS id,
      codigo,
      nombre,
      activo,
      TRUE AS secreto_configurado
    `,
    [companyId, id, normalizedReference]
  )

  if (!result.rows[0]) {
    throw new IntegrationSecretReferenceError(
      'INTEGRATION_SECRET_TARGET_NOT_FOUND',
      'La integración no existe dentro de la empresa',
      404
    )
  }

  return result.rows[0]
}

module.exports = {
  IntegrationSecretReferenceError,
  configureSecretReference,
  findIntegrationTarget,
  normalizeBigint,
  normalizeSecretReference
}
