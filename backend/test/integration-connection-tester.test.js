'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  BancoAztecaError
} = require('../integrations/banco-azteca/errors')
const {
  IntegrationConnectionTestError,
  assertTestable,
  testIntegrationConnection
} = require(
  '../integrations/integration-connection-tester'
)

const usuario = {
  id: 8,
  rol: 'Administrador',
  empresa_id: 7
}

function target(overrides = {}) {
  return {
    id: '20',
    origen_id: '10',
    codigo: 'banco_azteca_api',
    nombre: 'API Banco Azteca',
    adaptador: 'banco_azteca_api',
    activo: true,
    origen_activo: true,
    tipo_activo: true,
    referencia_secreto: 'servidor:backend_env_banco_azteca',
    ...overrides
  }
}

function controlledDependencies(overrides = {}) {
  const calls = []
  const dependencies = {
    async findTarget(input) {
      calls.push({ name: 'findTarget', input })
      return target()
    },
    async startExecution(input) {
      calls.push({ name: 'startExecution', input })
      return { id: '30' }
    },
    async finishExecution(input) {
      calls.push({ name: 'finishExecution', input })
      return {
        id: input.executionId,
        estado: input.status
      }
    },
    buildEnvironment(input) {
      calls.push({ name: 'buildEnvironment', input })
      return {
        env: {
          BAZ_BASE_URL: 'https://example.test',
          BAZ_CONSUMER_KEY: 'protegida',
          BAZ_CONSUMER_SECRET: 'protegida',
          BAZ_ID_DESPACHO: '1',
          BAZ_ID_ESTATUS: '1',
          BAZ_ID_CANAL_ENVIO: '1'
        }
      }
    },
    readConfig(env) {
      calls.push({ name: 'readConfig', env })
      return { baseUrl: env.BAZ_BASE_URL }
    },
    createClient(config) {
      calls.push({ name: 'createClient', config })
      return {
        async getToken() {
          calls.push({ name: 'getToken' })
          return 'token-que-no-debe-salir'
        }
      }
    },
    logger: {
      error(event, detail) {
        calls.push({ name: 'logError', event, detail })
      }
    },
    ...overrides
  }

  return { calls, dependencies }
}

test('rechaza adaptadores no soportados antes de auditar', () => {
  assert.throws(
    () => assertTestable(target({ adaptador: 'sftp' })),
    error => (
      error.code
        === 'INTEGRATION_CONNECTION_ADAPTER_UNSUPPORTED'
    )
  )
})

test('requiere integración activa y referencia protegida', () => {
  assert.throws(
    () => assertTestable(target({ activo: false })),
    error => (
      error.code === 'INTEGRATION_CONNECTION_INACTIVE'
    )
  )
  assert.throws(
    () => assertTestable(target({ referencia_secreto: null })),
    error => (
      error.code === 'INTEGRATION_CONNECTION_SECRET_REQUIRED'
    )
  )
})

test('prueba autenticación y descarta token y referencia', async () => {
  const context = controlledDependencies()

  const result = await testIntegrationConnection({
    pool: {},
    usuario,
    integrationId: '20',
    dependencies: context.dependencies
  })

  assert.deepEqual(result, {
    ok: true,
    code: 'INTEGRATION_CONNECTION_OK',
    estado: 'completada',
    ejecucion_id: '30'
  })
  assert.deepEqual(
    context.calls.find(call => call.name === 'startExecution').input,
    {
      pool: {},
      empresaId: 7,
      integracionId: '20',
      stage: 'prueba',
      trigger: 'manual'
    }
  )
  assert.equal(
    context.calls.find(call => call.name === 'finishExecution')
      .input.status,
    'completada'
  )
  assert.doesNotMatch(JSON.stringify(result), /token|servidor:/i)
})

test('audita rechazo del proveedor sin revelar su mensaje', async () => {
  const rawError = new BancoAztecaError(
    'TOKEN respondió 401 con secreto=valor',
    {
      code: 'BAZ_HTTP_ERROR',
      httpStatus: 401
    }
  )
  const context = controlledDependencies({
    createClient() {
      return {
        async getToken() {
          throw rawError
        }
      }
    }
  })

  await assert.rejects(
    () => testIntegrationConnection({
      pool: {},
      usuario,
      integrationId: '20',
      dependencies: context.dependencies
    }),
    error => (
      error instanceof IntegrationConnectionTestError
      && error.code === 'INTEGRATION_CONNECTION_AUTH_REJECTED'
      && !error.message.includes('secreto=valor')
    )
  )

  const finish = context.calls.find(
    call => call.name === 'finishExecution'
  )
  assert.equal(finish.input.status, 'fallida')
  assert.equal(
    finish.input.errorCode,
    'INTEGRATION_CONNECTION_AUTH_REJECTED'
  )
})

test('distingue una falla de cierre de auditoría', async () => {
  const context = controlledDependencies({
    async finishExecution() {
      throw Object.assign(new Error('detalle interno'), {
        code: 'DB_TEMPORARY_ERROR'
      })
    }
  })

  await assert.rejects(
    () => testIntegrationConnection({
      pool: {},
      usuario,
      integrationId: '20',
      dependencies: context.dependencies
    }),
    error => (
      error.code === 'INTEGRATION_CONNECTION_AUDIT_FAILED'
      && !error.message.includes('detalle interno')
    )
  )

  assert.deepEqual(
    context.calls.find(call => call.name === 'logError').detail,
    { code: 'DB_TEMPORARY_ERROR' }
  )
})

test('la ruta es administrativa y no recibe credenciales', () => {
  const routes = fs.readFileSync(
    path.join(__dirname, '../routes/integrations.routes.js'),
    'utf8'
  )
  const controller = fs.readFileSync(
    path.join(__dirname, '../controllers/integrations.controller.js'),
    'utf8'
  )

  assert.match(
    routes,
    /router\.use\([\s\S]*verificaToken,[\s\S]*requiereEmpresa,[\s\S]*requiereAdmin[\s\S]*\)/
  )
  assert.match(
    routes,
    /'\/integraciones\/:id\/probar-conexion'[\s\S]*probarConexionIntegracion/
  )
  assert.match(controller, /integrationId: req\.params\.id/)
  assert.doesNotMatch(
    controller,
    /probarConexionIntegracion[\s\S]{0,400}req\.body/
  )
})
