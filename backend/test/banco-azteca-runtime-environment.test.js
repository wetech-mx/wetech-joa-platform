'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  buildBancoAztecaRuntimeEnvironment,
  secretReferenceFrom
} = require(
  '../integrations/banco-azteca/runtime-environment'
)

const exportScriptPath = path.join(
  __dirname,
  '..',
  'scripts',
  'export-banco-azteca-daily.js'
)
const serviceUnitPath = path.join(
  __dirname,
  '..',
  '..',
  'deploy',
  'systemd',
  'banco-azteca-cartera.service'
)
const registryTemplatePath = path.join(
  __dirname,
  '..',
  '..',
  'deploy',
  'security',
  'integraciones-referencias.example.json'
)
const runtimeTemplatePath = path.join(
  __dirname,
  '..',
  '..',
  'deploy',
  'security',
  'banco-azteca-runtime.example.env'
)

test('conserva modo legacy cuando no existe referencia', () => {
  const env = {
    BAZ_BASE_URL: 'https://example.test'
  }
  let resolverCalled = false

  const result = buildBancoAztecaRuntimeEnvironment({
    env,
    resolver() {
      resolverCalled = true
    }
  })

  assert.equal(result.mode, 'legacy')
  assert.equal(result.env, env)
  assert.equal(resolverCalled, false)
})

test('mezcla configuración protegida sin modificar el entorno original', () => {
  const env = {
    BAZ_SECRET_REFERENCE:
      'servidor:backend_env_banco_azteca',
    BAZ_EXPORT_OUTBOX: '/srv/outbox',
    BAZ_CONSUMER_KEY: 'valor_anterior'
  }

  const result = buildBancoAztecaRuntimeEnvironment({
    env,
    resolver(reference) {
      assert.equal(
        reference,
        'servidor:backend_env_banco_azteca'
      )

      return {
        source: 'archivo_env',
        value: {
          BAZ_CONSUMER_KEY: 'valor_protegido',
          BAZ_CONSUMER_SECRET: 'otro_controlado'
        },
        fieldCount: 2
      }
    }
  })

  assert.equal(result.mode, 'referencia_protegida')
  assert.equal(result.fieldCount, 2)
  assert.equal(
    result.env.BAZ_EXPORT_OUTBOX,
    '/srv/outbox'
  )
  assert.equal(
    result.env.BAZ_CONSUMER_KEY,
    'valor_protegido'
  )
  assert.equal(
    env.BAZ_CONSUMER_KEY,
    'valor_anterior'
  )
})

test('rechaza una referencia que no entregue archivo env', () => {
  assert.throws(
    () => buildBancoAztecaRuntimeEnvironment({
      env: {
        BAZ_SECRET_REFERENCE: 'entorno:cliente_api'
      },
      resolver() {
        return {
          source: 'entorno',
          value: 'controlado',
          fieldCount: 1
        }
      }
    }),
    error => (
      error.code
      === 'BAZ_SECRET_REFERENCE_SOURCE_INVALID'
    )
  )
})

test('normaliza la referencia sin revelar su contenido', () => {
  assert.equal(
    secretReferenceFrom({
      BAZ_SECRET_REFERENCE:
        '  servidor:backend_env_banco_azteca  '
    }),
    'servidor:backend_env_banco_azteca'
  )
})

test('el exportador evita cargar dotenv en modo protegido', () => {
  const source = fs.readFileSync(
    exportScriptPath,
    'utf8'
  )

  assert.match(
    source,
    /if \(!secretReferenceFrom\(env\)\)/
  )
  assert.match(
    source,
    /generateDailyPortfolio\(\{[\s\S]*env: runtime\.env/
  )
  assert.match(
    source,
    /BANCO_AZTECA_SECRET_SHOWN=NO/
  )
  assert.match(
    source,
    /stage: 'extraccion'/
  )
  assert.doesNotMatch(
    source,
    /BANCO_AZTECA_DAILY_EXPORT_ERROR'[\s\S]{0,200}message:/
  )
})

test('la importación registra su fase sin imprimir mensajes internos', () => {
  const importScriptPath = path.join(
    __dirname,
    '..',
    'scripts',
    'import-banco-azteca-daily.js'
  )
  const source = fs.readFileSync(importScriptPath, 'utf8')

  assert.match(source, /stage: 'importacion'/)
  assert.match(source, /classifyImportResult/)
  assert.doesNotMatch(
    source,
    /BANCO_AZTECA_DAILY_IMPORT_ERROR'[\s\S]{0,200}message:/
  )
})

test('systemd carga activación separada de las credenciales', () => {
  const unit = fs.readFileSync(
    serviceUnitPath,
    'utf8'
  )
  const runtimeTemplate = fs.readFileSync(
    runtimeTemplatePath,
    'utf8'
  )

  assert.match(
    unit,
    /EnvironmentFile=-\/etc\/wetech-crm\/integraciones\/banco-azteca-runtime\.env/
  )
  assert.match(
    unit,
    /ReadOnlyPaths=\/etc\/wetech-crm\/integraciones/
  )
  assert.match(
    runtimeTemplate,
    /^BAZ_SECRET_REFERENCE=servidor:backend_env_banco_azteca$/m
  )
  assert.doesNotMatch(
    runtimeTemplate,
    /PASSWORD|CONSUMER_SECRET|PRIVATE_KEY/
  )
})

test('el registro exige las seis variables bancarias', () => {
  const registry = JSON.parse(
    fs.readFileSync(registryTemplatePath, 'utf8')
  )
  const entry = registry.referencias[
    'servidor:backend_env_banco_azteca'
  ]

  assert.equal(entry.ruta, '/opt/crm/backend/.env')
  assert.deepEqual(
    entry.llaves_requeridas,
    [
      'BAZ_BASE_URL',
      'BAZ_CONSUMER_KEY',
      'BAZ_CONSUMER_SECRET',
      'BAZ_ID_DESPACHO',
      'BAZ_ID_ESTATUS',
      'BAZ_ID_CANAL_ENVIO'
    ]
  )
  assert.deepEqual(
    entry.llaves_permitidas,
    [
      'BAZ_BASE_URL',
      'BAZ_CONSUMER_KEY',
      'BAZ_CONSUMER_SECRET',
      'BAZ_ID_DESPACHO',
      'BAZ_ID_ESTATUS',
      'BAZ_ID_CANAL_ENVIO',
      'BAZ_TIMEOUT_MS',
      'BAZ_MAX_PAGES'
    ]
  )
})
