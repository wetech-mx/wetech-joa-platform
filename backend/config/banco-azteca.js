const REQUIRED_VARIABLES = Object.freeze([
  'BAZ_BASE_URL',
  'BAZ_CONSUMER_KEY',
  'BAZ_CONSUMER_SECRET',
  'BAZ_ID_DESPACHO',
  'BAZ_ID_ESTATUS',
  'BAZ_ID_CANAL_ENVIO'
])

function missingVariables(env = process.env) {
  return REQUIRED_VARIABLES.filter(
    variable => !String(env[variable] || '').trim()
  )
}

function positiveInteger(value, variable) {
  const parsed = Number.parseInt(value, 10)

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${variable} debe ser un entero positivo`)
  }

  return parsed
}

function boundedInteger(value, fallback, minimum, maximum, variable) {
  if (value === undefined || value === '') {
    return fallback
  }

  const parsed = Number.parseInt(value, 10)

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(
      `${variable} debe estar entre ${minimum} y ${maximum}`
    )
  }

  return parsed
}

function parseBaseUrl(value, env) {
  const url = new URL(value)
  const localTest =
    env.NODE_ENV === 'test' &&
    ['localhost', '127.0.0.1'].includes(url.hostname)

  if (url.protocol !== 'https:' && !localTest) {
    throw new Error('BAZ_BASE_URL debe utilizar HTTPS')
  }

  return url.toString().replace(/\/$/, '')
}

function getBancoAztecaConfig(env = process.env) {
  const missing = missingVariables(env)

  if (missing.length) {
    throw new Error(
      `Configuración Banco Azteca incompleta: ${missing.join(', ')}`
    )
  }

  return Object.freeze({
    baseUrl: parseBaseUrl(env.BAZ_BASE_URL, env),
    consumerKey: env.BAZ_CONSUMER_KEY.trim(),
    consumerSecret: env.BAZ_CONSUMER_SECRET.trim(),
    idDespacho: positiveInteger(
      env.BAZ_ID_DESPACHO,
      'BAZ_ID_DESPACHO'
    ),
    idEstatus: positiveInteger(
      env.BAZ_ID_ESTATUS,
      'BAZ_ID_ESTATUS'
    ),
    idCanalEnvio: positiveInteger(
      env.BAZ_ID_CANAL_ENVIO,
      'BAZ_ID_CANAL_ENVIO'
    ),
    timeoutMs: boundedInteger(
      env.BAZ_TIMEOUT_MS,
      30000,
      5000,
      120000,
      'BAZ_TIMEOUT_MS'
    ),
    maxPages: boundedInteger(
      env.BAZ_MAX_PAGES,
      5000,
      1,
      10000,
      'BAZ_MAX_PAGES'
    )
  })
}

function getBancoAztecaConfigStatus(env = process.env) {
  const missing = missingVariables(env)

  if (missing.length) {
    return {
      configured: false,
      missing,
      invalid: false
    }
  }

  try {
    getBancoAztecaConfig(env)
  } catch {
    return {
      configured: false,
      missing: [],
      invalid: true
    }
  }

  return {
    configured: true,
    missing: [],
    invalid: false
  }
}

module.exports = {
  REQUIRED_VARIABLES,
  getBancoAztecaConfig,
  getBancoAztecaConfigStatus
}
