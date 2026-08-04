'use strict'

const {
  resolveSecretReference
} = require('../integration-secret-resolver')

class BancoAztecaRuntimeEnvironmentError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'BancoAztecaRuntimeEnvironmentError'
    this.code = code
  }
}

function secretReferenceFrom(env) {
  return String(
    env?.BAZ_SECRET_REFERENCE || ''
  ).trim()
}

function buildBancoAztecaRuntimeEnvironment({
  env = process.env,
  resolver = resolveSecretReference
} = {}) {
  const reference = secretReferenceFrom(env)

  if (!reference) {
    return {
      env,
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
    throw new BancoAztecaRuntimeEnvironmentError(
      'BAZ_SECRET_REFERENCE_SOURCE_INVALID',
      'La referencia de Banco Azteca debe resolver un archivo de entorno'
    )
  }

  return {
    env: {
      ...env,
      ...resolved.value
    },
    mode: 'referencia_protegida',
    fieldCount: resolved.fieldCount
  }
}

module.exports = {
  BancoAztecaRuntimeEnvironmentError,
  buildBancoAztecaRuntimeEnvironment,
  secretReferenceFrom
}
