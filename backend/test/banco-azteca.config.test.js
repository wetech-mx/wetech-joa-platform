const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getBancoAztecaConfig,
  getBancoAztecaConfigStatus
} = require('../config/banco-azteca')

const VALID_ENV = Object.freeze({
  NODE_ENV: 'test',
  BAZ_BASE_URL: 'http://127.0.0.1:9999',
  BAZ_CONSUMER_KEY: 'consumer-key',
  BAZ_CONSUMER_SECRET: 'consumer-secret',
  BAZ_ID_DESPACHO: '10',
  BAZ_ID_ESTATUS: '20',
  BAZ_ID_CANAL_ENVIO: '30'
})

test('configuración no expone secretos en su estado', () => {
  const status = getBancoAztecaConfigStatus(VALID_ENV)

  assert.deepEqual(status, {
    configured: true,
    missing: [],
    invalid: false
  })
  assert.equal(JSON.stringify(status).includes('consumer-secret'), false)
})

test('configuración reporta variables faltantes sin inventar valores', () => {
  const status = getBancoAztecaConfigStatus({})

  assert.equal(status.configured, false)
  assert.ok(status.missing.includes('BAZ_CONSUMER_SECRET'))
  assert.ok(status.missing.includes('BAZ_BASE_URL'))
})

test('estado rechaza una configuración presente pero inválida', () => {
  const status = getBancoAztecaConfigStatus({
    ...VALID_ENV,
    NODE_ENV: 'production',
    BAZ_BASE_URL: 'http://api.example.test'
  })

  assert.equal(status.configured, false)
  assert.equal(status.invalid, true)
  assert.deepEqual(status.missing, [])
})

test('configuración exige HTTPS fuera de pruebas locales', () => {
  assert.throws(
    () => getBancoAztecaConfig({
      ...VALID_ENV,
      NODE_ENV: 'production'
    }),
    /HTTPS/
  )
})

test('configuración convierte IDs y aplica límites seguros', () => {
  const config = getBancoAztecaConfig(VALID_ENV)

  assert.equal(config.idDespacho, 10)
  assert.equal(config.idEstatus, 20)
  assert.equal(config.idCanalEnvio, 30)
  assert.equal(config.timeoutMs, 30000)
  assert.equal(config.maxPages, 5000)
})

module.exports = {
  VALID_ENV
}
