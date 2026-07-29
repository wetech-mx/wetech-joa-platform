const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const XLSX = require('xlsx')

const {
  HEADERS
} = require('../integrations/banco-azteca/excel')
const {
  checksumFor,
  isValidIsoDate,
  parsePortfolioDate,
  readPortfolioWorkbook,
  validateHeaders
} = require('../importers/cartera-excel')

function workbookBuffer(headers, rows = []) {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([
    headers,
    ...rows
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

async function withTemporaryWorkbook(
  fileName,
  headers,
  rows,
  callback
) {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'cartera-import-')
  )
  const filePath = path.join(directory, fileName)

  try {
    const buffer = workbookBuffer(headers, rows)
    await fs.promises.writeFile(filePath, buffer)

    return await callback({
      buffer,
      filePath
    })
  } finally {
    await fs.promises.rm(directory, {
      recursive: true,
      force: true
    })
  }
}

test('define exactamente los 34 encabezados de cartera', () => {
  assert.equal(HEADERS.length, 34)
  assert.equal(HEADERS[0], 'IdCampaña')
  assert.equal(HEADERS[33], 'CodigoPostal')
})

test('acepta una fecha ISO real', () => {
  assert.equal(isValidIsoDate('2026-07-29'), true)
  assert.equal(isValidIsoDate('2024-02-29'), true)
})

test('rechaza una fecha de calendario imposible', () => {
  assert.equal(isValidIsoDate('2026-02-29'), false)
  assert.equal(isValidIsoDate('2026-13-01'), false)
  assert.equal(isValidIsoDate('29/07/2026'), false)
})

test('extrae la fecha desde el nombre oficial', () => {
  assert.equal(
    parsePortfolioDate(
      '/srv/outbox/Cartera_BancoAzteca_2026-07-29.xlsx'
    ),
    '2026-07-29'
  )
})

test('rechaza un nombre de archivo distinto al oficial', () => {
  assert.throws(
    () => parsePortfolioDate('cartera-2026-07-29.xlsx'),
    error => (
      error.code === 'BAZ_IMPORT_FILE_NAME_INVALID'
    )
  )
})

test('rechaza una fecha imposible dentro del nombre', () => {
  assert.throws(
    () => parsePortfolioDate(
      'Cartera_BancoAzteca_2026-02-29.xlsx'
    ),
    error => (
      error.code === 'BAZ_IMPORT_DATE_INVALID'
    )
  )
})

test('calcula SHA-256 de forma determinista', () => {
  assert.equal(
    checksumFor(Buffer.from('cartera-controlada')),
    '98d4fe47969504d3239b65b1e0b46e9cd1eb79bc44cb9adac74e7c5da0f144e1'
  )
})

test('acepta únicamente los encabezados exactos y ordenados', () => {
  assert.equal(validateHeaders([...HEADERS]), true)
})

test('rechaza una columna faltante', () => {
  assert.throws(
    () => validateHeaders(HEADERS.slice(0, -1)),
    error => (
      error.code === 'BAZ_IMPORT_HEADER_COUNT'
    )
  )
})

test('rechaza una columna adicional', () => {
  assert.throws(
    () => validateHeaders([
      ...HEADERS,
      'ColumnaNoAutorizada'
    ]),
    error => (
      error.code === 'BAZ_IMPORT_HEADER_COUNT'
    )
  )
})

test('rechaza columnas desordenadas', () => {
  const headers = [...HEADERS]

  ;[
    headers[0],
    headers[1]
  ] = [
    headers[1],
    headers[0]
  ]

  assert.throws(
    () => validateHeaders(headers),
    error => (
      error.code === 'BAZ_IMPORT_HEADER_MISMATCH'
      && error.details.column === 1
    )
  )
})

test('lee un Excel válido sin insertar datos', async () => {
  const row = HEADERS.map((header, index) => (
    `${header}-${index + 1}`
  ))

  await withTemporaryWorkbook(
    'Cartera_BancoAzteca_2026-07-29.xlsx',
    HEADERS,
    [row],
    async ({
      buffer,
      filePath
    }) => {
      const result = await readPortfolioWorkbook(filePath)

      assert.equal(result.date, '2026-07-29')
      assert.equal(result.totalRows, 1)
      assert.equal(result.headers.length, 34)
      assert.equal(
        result.sha256,
        checksumFor(buffer)
      )
      assert.equal(
        result.rows[0].IdCampaña,
        'IdCampaña-1'
      )
      assert.equal(
        result.rows[0].CodigoPostal,
        'CodigoPostal-34'
      )
    }
  )
})

test('rechaza un Excel sin registros de cartera', async () => {
  await withTemporaryWorkbook(
    'Cartera_BancoAzteca_2026-07-29.xlsx',
    HEADERS,
    [],
    async ({
      filePath
    }) => {
      await assert.rejects(
        () => readPortfolioWorkbook(filePath),
        error => (
          error.code === 'BAZ_IMPORT_NO_DATA'
        )
      )
    }
  )
})
