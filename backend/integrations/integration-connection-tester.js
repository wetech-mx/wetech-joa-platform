'use strict'

const {
  getBancoAztecaConfig
} = require('../config/banco-azteca')
const {
  finishIntegrationExecution,
  startIntegrationExecution
} = require(
  '../repositories/integration-execution-repository'
)
const {
  getIntegrationConnectionTarget
} = require(
  '../repositories/integrations-management-repository'
)
const {
  createBancoAztecaClient
} = require('./banco-azteca/client')
const {
  BancoAztecaError
} = require('./banco-azteca/errors')
const {
  buildBancoAztecaRuntimeEnvironment
} = require('./banco-azteca/runtime-environment')

const SUPPORTED_ADAPTER = 'banco_azteca_api'

class IntegrationConnectionTestError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'IntegrationConnectionTestError'
    this.code = code
    this.status = status
  }
}

function assertTestable(target) {
  if (
    !target.activo
    || !target.origen_activo
    || !target.tipo_activo
  ) {
    throw new IntegrationConnectionTestError(
      'INTEGRATION_CONNECTION_INACTIVE',
      'La integración, su origen o su tipo están inactivos',
      409
    )
  }

  if (target.adaptador !== SUPPORTED_ADAPTER) {
    throw new IntegrationConnectionTestError(
      'INTEGRATION_CONNECTION_ADAPTER_UNSUPPORTED',
      'El adaptador todavía no admite una prueba de conexión',
      422
    )
  }

  if (!String(target.referencia_secreto || '').trim()) {
    throw new IntegrationConnectionTestError(
      'INTEGRATION_CONNECTION_SECRET_REQUIRED',
      'La integración requiere una referencia protegida configurada',
      409
    )
  }
}

function controlledProviderError(error) {
  if (
    error instanceof BancoAztecaError
    && error.code === 'BAZ_HTTP_ERROR'
    && [401, 403].includes(error.httpStatus)
  ) {
    return new IntegrationConnectionTestError(
      'INTEGRATION_CONNECTION_AUTH_REJECTED',
      'El proveedor rechazó la autenticación configurada',
      422
    )
  }

  if (error instanceof BancoAztecaError) {
    return new IntegrationConnectionTestError(
      'INTEGRATION_CONNECTION_PROVIDER_UNAVAILABLE',
      'El proveedor no respondió correctamente a la prueba',
      502
    )
  }

  return new IntegrationConnectionTestError(
    'INTEGRATION_CONNECTION_CONFIGURATION_INVALID',
    'La configuración protegida no pudo utilizarse para la prueba',
    422
  )
}

async function safelyRecordFailure({
  finishExecution,
  pool,
  companyId,
  executionId,
  errorCode,
  logger
}) {
  try {
    await finishExecution({
      pool,
      empresaId: companyId,
      executionId,
      status: 'fallida',
      errorCode
    })
  } catch (error) {
    logger.error('INTEGRATION_CONNECTION_AUDIT_ERROR', {
      code: error?.code || 'UNEXPECTED'
    })
  }
}

async function testIntegrationConnection({
  pool,
  usuario,
  integrationId,
  dependencies = {}
}) {
  const findTarget = dependencies.findTarget
    || getIntegrationConnectionTarget
  const startExecution = dependencies.startExecution
    || startIntegrationExecution
  const finishExecution = dependencies.finishExecution
    || finishIntegrationExecution
  const buildEnvironment = dependencies.buildEnvironment
    || buildBancoAztecaRuntimeEnvironment
  const readConfig = dependencies.readConfig
    || getBancoAztecaConfig
  const createClient = dependencies.createClient
    || createBancoAztecaClient
  const logger = dependencies.logger || console
  const companyId = usuario?.empresa_id

  const target = await findTarget({
    pool,
    usuario,
    integrationId
  })

  assertTestable(target)

  const execution = await startExecution({
    pool,
    empresaId: companyId,
    integracionId: target.id,
    stage: 'prueba',
    trigger: 'manual'
  })

  try {
    const runtime = buildEnvironment({
      env: {
        ...process.env,
        BAZ_SECRET_REFERENCE: target.referencia_secreto
      }
    })
    const config = readConfig(runtime.env)
    const client = createClient(config)

    // El valor devuelto es sensible y se descarta inmediatamente.
    await client.getToken()

  } catch (error) {
    const controlled = controlledProviderError(error)

    await safelyRecordFailure({
      finishExecution,
      pool,
      companyId,
      executionId: execution.id,
      errorCode: controlled.code,
      logger
    })

    throw controlled
  }

  let completed

  try {
    completed = await finishExecution({
      pool,
      empresaId: companyId,
      executionId: execution.id,
      status: 'completada'
    })
  } catch (error) {
    logger.error('INTEGRATION_CONNECTION_AUDIT_ERROR', {
      code: error?.code || 'UNEXPECTED'
    })

    throw new IntegrationConnectionTestError(
      'INTEGRATION_CONNECTION_AUDIT_FAILED',
      'La prueba terminó, pero no fue posible cerrar su auditoría',
      500
    )
  }

  return {
    ok: true,
    code: 'INTEGRATION_CONNECTION_OK',
    estado: completed.estado,
    ejecucion_id: completed.id
  }
}

module.exports = {
  IntegrationConnectionTestError,
  SUPPORTED_ADAPTER,
  assertTestable,
  controlledProviderError,
  testIntegrationConnection
}
