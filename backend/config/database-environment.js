'use strict'

const {
  resolveSecretReference
} = require('../integrations/integration-secret-resolver')

const DATABASE_KEYS = Object.freeze([
  'DB_USER',
  'DB_HOST',
  'DB_NAME',
  'DB_PASSWORD',
  'DB_PORT'
])

class DatabaseEnvironmentError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'DatabaseEnvironmentError'
    this.code = code
  }
}

function databaseReferenceFrom(env) {
  return String(
    env?.DB_SECRET_REFERENCE || ''
  ).trim()
}

function selectDatabaseConfiguration(value = {}) {
  return Object.fromEntries(
    DATABASE_KEYS.map(key => [
      key,
      value[key]
    ])
  )
}

function assertCompleteConfiguration(configuration) {
  const missing = DATABASE_KEYS.filter(key => (
    typeof configuration[key] !== 'string'
    || configuration[key].length === 0
  ))

  if (missing.length > 0) {
    throw new DatabaseEnvironmentError(
      'DATABASE_SECRET_CONFIGURATION_INCOMPLETE',
      'La referencia protegida de PostgreSQL está incompleta'
    )
  }
}

function buildDatabaseEnvironment({
  env = process.env,
  resolver = resolveSecretReference
} = {}) {
  const reference = databaseReferenceFrom(env)

  if (!reference) {
    return {
      configuration: selectDatabaseConfiguration(env),
      mode: 'legacy',
      fieldCount: 0
    }
  }

  const resolved = resolver(reference)

  if (
    resolved?.source !== 'archivo_env'
    || !resolved.value
    || Array.isArray(resolved.value)
    || typeof resolved.value !== 'object'
  ) {
    throw new DatabaseEnvironmentError(
      'DATABASE_SECRET_REFERENCE_SOURCE_INVALID',
      'La referencia de PostgreSQL debe resolver un archivo de entorno'
    )
  }

  const configuration =
    selectDatabaseConfiguration(resolved.value)

  assertCompleteConfiguration(configuration)

  return {
    configuration,
    mode: 'referencia_protegida',
    fieldCount: DATABASE_KEYS.length
  }
}

module.exports = {
  DATABASE_KEYS,
  DatabaseEnvironmentError,
  assertCompleteConfiguration,
  buildDatabaseEnvironment,
  databaseReferenceFrom,
  selectDatabaseConfiguration
}
