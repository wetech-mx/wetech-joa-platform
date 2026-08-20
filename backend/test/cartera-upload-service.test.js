const test = require('node:test')
const assert = require('node:assert/strict')
const XLSX = require('xlsx')

const {
  checksumFor,
  SCL_HEADERS
} = require('../importers/cartera-excel')
const {
  getPortfolioImportJob,
  previewPortfolioUpload,
  startPortfolioImport
} = require('../services/cartera-upload-service')

function sclBuffer() {
  const row = SCL_HEADERS.map(() => 'N/A')
  const set = (field, value) => {
    row[SCL_HEADERS.indexOf(field)] = value
  }

  set('CLIENTE_UNICO', '0001234567890')
  set('NOMBRE_CTE', 'Cliente controlado')
  set('CAMPANIA', 'SEGMENTO-5')
  set('SALDO_TOTAL', '1250.50')
  set('TELEFONO1', '5512345678')

  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    [SCL_HEADERS.join('|')],
    [row.join('|')]
  ])

  XLSX.utils.book_append_sheet(
    workbook,
    sheet,
    'Cartera'
  )

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
    compression: true
  })
}

function targetPool() {
  const calls = []

  return {
    calls,
    async query(text, values) {
      calls.push({ text, values })

      return {
        rows: [
          {
            origen_id: '4',
            origen_codigo: 'banco_azteca',
            origen_nombre: 'Banco Azteca',
            integracion_id: '8',
            integracion_nombre: 'API Banco Azteca'
          }
        ]
      }
    }
  }
}

function admin(empresaId = 7) {
  return {
    id: 2,
    empresa_id: empresaId,
    rol: 'Administrador'
  }
}

test('la vista previa valida sin persistir cuentas', async () => {
  const buffer = sclBuffer()
  const pool = targetPool()
  const result = await previewPortfolioUpload({
    pool,
    usuario: admin(),
    originId: '4',
    buffer,
    fileName: 'Descarga_cartera.xlsx',
    date: '2026-08-20'
  })

  assert.equal(result.totalRows, 1)
  assert.equal(result.fields, 94)
  assert.equal(result.campaigns, 1)
  assert.equal(result.accountsWithPhone, 1)
  assert.equal(result.totalBalance, 1250.5)
  assert.equal(result.sha256, checksumFor(buffer))
  assert.equal(pool.calls.length, 1)
  assert.deepEqual(pool.calls[0].values, ['4', 7])
})

test('la confirmación exige el mismo hash de la vista previa', async () => {
  const buffer = sclBuffer()

  await assert.rejects(
    () => startPortfolioImport({
      pool: targetPool(),
      usuario: admin(),
      originId: '4',
      buffer,
      fileName: 'Descarga_cartera.xlsx',
      date: '2026-08-20',
      previewSha256: 'a'.repeat(64)
    }),
    error => (
      error.code === 'CARTERA_IMPORT_FILE_CHANGED'
    )
  )
})

test('ejecuta la importación como trabajo consultable', async () => {
  const buffer = sclBuffer()
  let persistedInput
  const started = await startPortfolioImport({
    pool: targetPool(),
    usuario: admin(),
    originId: '4',
    buffer,
    fileName: 'Descarga_cartera.xlsx',
    date: '2026-08-20',
    previewSha256: checksumFor(buffer),
    async persistFn(input) {
      persistedInput = input

      return {
        status: 'imported',
        totalRows: 1,
        newRecords: 1,
        updatedRecords: 0,
        assignedRecords: 1
      }
    }
  })

  assert.equal(started.status, 'queued')

  await new Promise(resolve => setImmediate(resolve))

  const completed = getPortfolioImportJob({
    usuario: admin(),
    jobId: started.id
  })

  assert.equal(completed.status, 'completed')
  assert.equal(completed.result.newRecords, 1)
  assert.equal(persistedInput.empresaId, 7)
  assert.equal(persistedInput.origenId, '4')
  assert.equal(persistedInput.integracionId, '8')
  assert.equal(persistedInput.portfolio.totalRows, 1)
})

test('un trabajo no puede consultarse desde otra empresa', async () => {
  const buffer = sclBuffer()
  const started = await startPortfolioImport({
    pool: targetPool(),
    usuario: admin(),
    originId: '4',
    buffer,
    fileName: 'Descarga_cartera.xlsx',
    date: '2026-08-21',
    previewSha256: checksumFor(buffer),
    async persistFn() {
      return {
        status: 'imported',
        totalRows: 1
      }
    }
  })

  assert.throws(
    () => getPortfolioImportJob({
      usuario: admin(99),
      jobId: started.id
    }),
    error => (
      error.code === 'CARTERA_IMPORT_JOB_NOT_FOUND'
    )
  )
})
