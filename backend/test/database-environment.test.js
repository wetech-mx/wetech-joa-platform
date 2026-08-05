'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  DATABASE_KEYS,
  buildDatabaseEnvironment,
  databaseReferenceFrom
} = require('../config/database-environment')

const databaseSourcePath = path.join(
  __dirname,
  '..',
  'config',
  'database.js'
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

const controlledConfiguration = Object.freeze({
  DB_USER: 'usuario_controlado',
  DB_HOST: 'host.controlado',
  DB_NAME: 'base_controlada',
  DB_PASSWORD: 'valor_controlado',
  DB_PORT: '5432'
})

test('conserva PostgreSQL legacy sin referencia protegida', () => {
  let resolverCalled = false

  const result = buildDatabaseEnvironment({
    env: controlledConfiguration,
    resolver() {
      resolverCalled = true
    }
  })

  assert.equal(result.mode, 'legacy')
  assert.equal(result.fieldCount, 0)
  assert.deepEqual(
    result.configuration,
    controlledConfiguration
  )
  assert.equal(resolverCalled, false)
})

test('resuelve PostgreSQL desde referencia protegida', () => {
  const env = {
    DB_SECRET_REFERENCE:
      'servidor:backend_env_postgresql'
  }

  const result = buildDatabaseEnvironment({
    env,
    resolver(reference) {
      assert.equal(
        reference,
        'servidor:backend_env_postgresql'
      )

      return {
        source: 'archivo_env',
        value: controlledConfiguration,
        fieldCount: DATABASE_KEYS.length
      }
    }
  })

  assert.equal(result.mode, 'referencia_protegida')
  assert.equal(result.fieldCount, DATABASE_KEYS.length)
  assert.deepEqual(
    result.configuration,
    controlledConfiguration
  )
  assert.equal(env.DB_USER, undefined)
})

test('rechaza fuentes distintas de archivo env', () => {
  assert.throws(
    () => buildDatabaseEnvironment({
      env: {
        DB_SECRET_REFERENCE: 'entorno:postgresql'
      },
      resolver() {
        return {
          source: 'entorno',
          value: 'no_permitido',
          fieldCount: 1
        }
      }
    }),
    error => (
      error.code
      === 'DATABASE_SECRET_REFERENCE_SOURCE_INVALID'
    )
  )
})

test('rechaza una configuración protegida incompleta', () => {
  assert.throws(
    () => buildDatabaseEnvironment({
      env: {
        DB_SECRET_REFERENCE:
          'servidor:backend_env_postgresql'
      },
      resolver() {
        return {
          source: 'archivo_env',
          value: {
            ...controlledConfiguration,
            DB_PASSWORD: ''
          },
          fieldCount: DATABASE_KEYS.length - 1
        }
      }
    }),
    error => (
      error.code
      === 'DATABASE_SECRET_CONFIGURATION_INCOMPLETE'
    )
  )
})

test('normaliza la referencia de PostgreSQL', () => {
  assert.equal(
    databaseReferenceFrom({
      DB_SECRET_REFERENCE:
        '  servidor:backend_env_postgresql  '
    }),
    'servidor:backend_env_postgresql'
  )
})

test('el pool usa el entorno protegido sin cargar dotenv', () => {
  const source = fs.readFileSync(
    databaseSourcePath,
    'utf8'
  )

  assert.match(source, /buildDatabaseEnvironment\(\)/)
  assert.match(source, /configuration\.DB_PASSWORD/)
  assert.doesNotMatch(source, /dotenv/)
  assert.doesNotMatch(source, /console\./)
})

test('las plantillas aíslan las cinco llaves de PostgreSQL', () => {
  const registry = JSON.parse(
    fs.readFileSync(registryTemplatePath, 'utf8')
  )
  const entry = registry.referencias[
    'servidor:backend_env_postgresql'
  ]
  const runtime = fs.readFileSync(
    runtimeTemplatePath,
    'utf8'
  )

  assert.equal(entry.ruta, '/opt/crm/backend/.env')
  assert.deepEqual(entry.llaves_requeridas, DATABASE_KEYS)
  assert.deepEqual(entry.llaves_permitidas, DATABASE_KEYS)
  assert.match(
    runtime,
    /^DB_SECRET_REFERENCE=servidor:backend_env_postgresql$/m
  )
  assert.doesNotMatch(
    runtime,
    /^DB_(?:USER|HOST|NAME|PASSWORD|PORT)=/m
  )
})
