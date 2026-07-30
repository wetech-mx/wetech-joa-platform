'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

const {
  CarteraDailyImportError,
  hashesMatch,
  importDailyPortfolio,
  parseChecksumDocument,
  parsePositiveInteger,
  resolvePortfolioDate,
  resolvePortfolioPaths
} = require('../scripts/import-banco-azteca-daily')

const FILE_NAME =
  'Cartera_BancoAzteca_2026-07-29.xlsx'
const HASH = crypto
  .createHash('sha256')
  .update('cartera-controlada')
  .digest('hex')

function controlledEnvironment(overrides = {}) {
  return {
    BAZ_EXPORT_DATE: '2026-07-29',
    BAZ_EXPORT_OUTBOX: '/srv/banco-azteca-transfer/outbox',
    BAZ_IMPORT_EMPRESA_ID: '1',
    ...overrides
  }
}

function controlledPortfolio(overrides = {}) {
  return {
    date: '2026-07-29',
    fileName: FILE_NAME,
    sha256: HASH,
    records: [
      {
        identity: {
          idCampania: 'CAMPAÑA-1',
          idCliente: 'CLIENTE-1',
          key: 'CAMPAÑA-1\u0000CLIENTE-1'
        },
        snapshot: {}
      }
    ],
    totalRows: 1,
    ...overrides
  }
}

test('acepta enteros positivos de configuración', () => {
  assert.equal(
    parsePositiveInteger(
      '1',
      'BAZ_IMPORT_EMPRESA_ID'
    ),
    1
  )

  assert.equal(
    parsePositiveInteger(
      '',
      'BAZ_IMPORT_USER_ID',
      {
        required: false
      }
    ),
    null
  )
})

test('rechaza identificadores inválidos', () => {
  assert.throws(
    () => parsePositiveInteger(
      '0',
      'BAZ_IMPORT_EMPRESA_ID'
    ),
    error => (
      error instanceof CarteraDailyImportError
      && error.code
        === 'BAZ_IMPORT_ENV_INTEGER_INVALID'
    )
  )
})

test('usa la fecha explícita configurada', () => {
  assert.equal(
    resolvePortfolioDate({
      env: controlledEnvironment()
    }),
    '2026-07-29'
  )
})

test('calcula el día hábil anterior sin fecha explícita', () => {
  assert.equal(
    resolvePortfolioDate({
      now: new Date('2026-07-30T12:00:00Z'),
      env: controlledEnvironment({
        BAZ_EXPORT_DATE: ''
      })
    }),
    '2026-07-29'
  )
})

test('construye rutas exactas dentro del outbox', () => {
  const result = resolvePortfolioPaths({
    env: controlledEnvironment()
  })

  assert.equal(result.fileName, FILE_NAME)
  assert.equal(
    result.filePath,
    `/srv/banco-azteca-transfer/outbox/${FILE_NAME}`
  )
  assert.equal(
    result.checksumPath,
    `/srv/banco-azteca-transfer/outbox/${FILE_NAME}.sha256`
  )
})

test('rechaza un outbox que no sea ruta absoluta', () => {
  assert.throws(
    () => resolvePortfolioPaths({
      env: controlledEnvironment({
        BAZ_EXPORT_OUTBOX: 'outbox'
      })
    }),
    error => (
      error.code === 'BAZ_IMPORT_OUTBOX_INVALID'
    )
  )
})

test('acepta el formato SHA-256 generado por el exportador', () => {
  assert.equal(
    parseChecksumDocument(
      `${HASH}  ${FILE_NAME}\n`,
      FILE_NAME
    ),
    HASH
  )
})

test('rechaza un SHA-256 asociado a otro archivo', () => {
  assert.throws(
    () => parseChecksumDocument(
      `${HASH}  archivo-distinto.xlsx\n`,
      FILE_NAME
    ),
    error => (
      error.code
        === 'BAZ_IMPORT_CHECKSUM_FILENAME_MISMATCH'
    )
  )
})

test('compara hashes sin filtrar diferencias de tiempo', () => {
  const differentHash = [
    HASH.slice(0, -1),
    HASH.endsWith('0') ? '1' : '0'
  ].join('')

  assert.equal(hashesMatch(HASH, HASH), true)
  assert.equal(
    hashesMatch(HASH, differentHash),
    false
  )
  assert.equal(hashesMatch('invalido', HASH), false)
})

test('valida SHA-256 antes de persistir la cartera', async () => {
  let persisted = false

  await assert.rejects(
    () => importDailyPortfolio({
      env: controlledEnvironment(),
      pool: {},
      readFileFn: async () =>
        `${'0'.repeat(64)}  ${FILE_NAME}\n`,
      readPortfolioFn: async () =>
        controlledPortfolio(),
      persistFn: async () => {
        persisted = true
      }
    }),
    error => (
      error.code === 'BAZ_IMPORT_CHECKSUM_MISMATCH'
    )
  )

  assert.equal(persisted, false)
})

test('envía la cartera validada a persistencia', async () => {
  const calls = []

  const result = await importDailyPortfolio({
    env: controlledEnvironment(),
    pool: {
      marker: 'pool-controlado'
    },
    readFileFn: async filePath => {
      calls.push([
        'checksum',
        filePath
      ])

      return `${HASH}  ${FILE_NAME}\n`
    },
    readPortfolioFn: async filePath => {
      calls.push([
        'workbook',
        filePath
      ])

      return controlledPortfolio()
    },
    persistFn: async input => {
      calls.push([
        'persist',
        input
      ])

      return {
        status: 'imported',
        importacionId: 10,
        campaigns: 1,
        totalRows: 1,
        newRecords: 1,
        updatedRecords: 0,
        assignedRecords: 1,
        keptAssignments: 0
      }
    }
  })

  assert.equal(result.status, 'imported')
  assert.equal(result.empresaId, 1)
  assert.equal(result.importacionId, 10)
  assert.equal(calls[2][1].empresaId, 1)
  assert.equal(calls[2][1].creadoPor, null)
  assert.equal(
    calls[2][1].portfolio.sha256,
    HASH
  )
})

test('conserva el resultado idempotente del repositorio', async () => {
  const result = await importDailyPortfolio({
    env: controlledEnvironment(),
    pool: {},
    readFileFn: async () =>
      `${HASH}  ${FILE_NAME}\n`,
    readPortfolioFn: async () =>
      controlledPortfolio(),
    persistFn: async () => ({
      status: 'already_imported',
      importacionId: 10,
      totalRows: 1
    })
  })

  assert.equal(result.status, 'already_imported')
  assert.equal(result.importacionId, 10)
})
