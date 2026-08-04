'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  configureSecretReference,
  findIntegrationTarget,
  normalizeBigint,
  normalizeSecretReference
} = require(
  '../repositories/integrations-secret-repository'
)
const {
  executeConfiguration,
  parseArguments
} = require(
  '../scripts/configure-integration-secret'
)

function mockPool(responses) {
  const calls = []

  return {
    calls,
    async query(text, values) {
      calls.push({ text, values })
      const response = responses.shift()

      if (!response) {
        throw new Error('Falta respuesta simulada')
      }

      return response
    }
  }
}

function captureLogger() {
  const lines = []

  return {
    lines,
    log(value) {
      lines.push(String(value))
    }
  }
}

test('acepta la referencia existente de Banco Azteca', () => {
  assert.equal(
    normalizeSecretReference(
      'servidor:backend_env_banco_azteca'
    ),
    'servidor:backend_env_banco_azteca'
  )
})

test('acepta alias para archivo seguro y entorno', () => {
  assert.equal(
    normalizeSecretReference('archivo_seguro:sae_firebird'),
    'archivo_seguro:sae_firebird'
  )
  assert.equal(
    normalizeSecretReference('entorno:cliente_api'),
    'entorno:cliente_api'
  )
})

test('rechaza rutas, URLs y contenido que podría ser secreto', () => {
  for (const value of [
    'archivo_seguro:../credenciales',
    'archivo_seguro:/etc/crm/secreto.json',
    'https://servidor/token',
    'password=valor',
    'servidor:AliasConMayusculas'
  ]) {
    assert.throws(
      () => normalizeSecretReference(value),
      error => (
        error.code
        === 'INTEGRATION_SECRET_REFERENCE_INVALID'
      )
    )
  }
})

test('conserva identificadores BIGINT como texto', () => {
  assert.equal(
    normalizeBigint('9007199254740993', 'id'),
    '9007199254740993'
  )
})

test('busca la integración dentro de su empresa', async () => {
  const pool = mockPool([{
    rows: [{
      id: '20',
      codigo: 'api_demo',
      nombre: 'API Demo',
      activo: false,
      secreto_configurado: false
    }]
  }])

  const result = await findIntegrationTarget({
    pool,
    empresaId: '7',
    integrationId: '20'
  })

  assert.equal(result.id, '20')
  assert.deepEqual(pool.calls[0].values, ['7', '20'])
  assert.match(
    pool.calls[0].text,
    /WHERE empresa_id = \$1::BIGINT/
  )
  assert.doesNotMatch(
    pool.calls[0].text,
    /referencia_secreto\s+AS/
  )
})

test('actualiza solo la referencia de la empresa objetivo', async () => {
  const pool = mockPool([{
    rows: [{
      id: '20',
      codigo: 'api_demo',
      nombre: 'API Demo',
      activo: false,
      secreto_configurado: true
    }]
  }])

  const result = await configureSecretReference({
    pool,
    empresaId: '7',
    integrationId: '20',
    reference: 'entorno:api_demo'
  })

  assert.equal(result.secreto_configurado, true)
  assert.equal(
    Object.hasOwn(result, 'referencia_secreto'),
    false
  )
  assert.deepEqual(
    pool.calls[0].values,
    ['7', '20', 'entorno:api_demo']
  )
})

test('rechaza una integración fuera del alcance', async () => {
  const pool = mockPool([{ rows: [] }])

  await assert.rejects(
    configureSecretReference({
      pool,
      empresaId: '7',
      integrationId: '99',
      reference: 'entorno:api_demo'
    }),
    error => (
      error.code
      === 'INTEGRATION_SECRET_TARGET_NOT_FOUND'
    )
  )
})

test('el comando rechaza opciones que podrían contener credenciales', () => {
  assert.throws(
    () => parseArguments([
      '--empresa-id', '7',
      '--integracion-id', '20',
      '--referencia', 'entorno:api_demo',
      '--password', 'valor'
    ]),
    /Opción no permitida/
  )
})

test('el comando opera en validación sin modificar PostgreSQL', async () => {
  const pool = mockPool([{
    rows: [{
      id: '20',
      codigo: 'api_demo',
      nombre: 'API Demo'
    }]
  }])
  const logger = captureLogger()
  const options = parseArguments([
    '--empresa-id', '7',
    '--integracion-id', '20',
    '--referencia', 'entorno:api_demo'
  ])

  const result = await executeConfiguration({
    pool,
    options,
    logger
  })

  assert.equal(result.status, 'validated')
  assert.equal(pool.calls.length, 1)
  assert.ok(logger.lines.includes('POSTGRESQL_MODIFICADO=NO'))
  assert.equal(
    logger.lines.some(line => line.includes('entorno:api_demo')),
    false
  )
})

test('el modo confirmado vincula sin mostrar la referencia', async () => {
  const pool = mockPool([
    {
      rows: [{
        id: '20',
        codigo: 'api_demo',
        nombre: 'API Demo'
      }]
    },
    {
      rows: [{
        id: '20',
        codigo: 'api_demo',
        nombre: 'API Demo',
        secreto_configurado: true
      }]
    }
  ])
  const logger = captureLogger()
  const options = parseArguments([
    '--empresa-id=7',
    '--integracion-id=20',
    '--referencia=archivo_seguro:api_demo',
    '--confirmar'
  ])

  const result = await executeConfiguration({
    pool,
    options,
    logger
  })

  assert.equal(result.status, 'configured')
  assert.equal(pool.calls.length, 2)
  assert.ok(logger.lines.includes('REFERENCIA_VINCULADA=OK'))
  assert.ok(logger.lines.includes('POSTGRESQL_MODIFICADO=SI'))
  assert.equal(
    logger.lines.some(
      line => line.includes('archivo_seguro:api_demo')
    ),
    false
  )
})
