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
  normalizeDate,
  normalizeDecimal,
  normalizeInteger,
  parsePortfolioDate,
  readPortfolioBuffer,
  readPortfolioWorkbook,
  SCL_HEADERS,
  expandSclPipeRows,
  isSclPipeWorkbook,
  transformPortfolioRow,
  transformPortfolioRows,
  transformSclPortfolioRow,
  validateHeaders,
  validateSclHeaders
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

function pipeWorkbookBuffer(headers, rows = []) {
  return workbookBuffer(
    [headers.join('|')],
    rows.map(row => [row.join('|')])
  )
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

async function withTemporaryBuffer(
  fileName,
  buffer,
  callback
) {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'cartera-source-')
  )
  const filePath = path.join(directory, fileName)

  try {
    await fs.promises.writeFile(filePath, buffer)
    return await callback({ buffer, filePath })
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

test('define los 94 campos observados en la descarga SCL', () => {
  assert.equal(SCL_HEADERS.length, 94)
  assert.equal(SCL_HEADERS[0], 'CLIENTE_UNICO')
  assert.equal(SCL_HEADERS[93], 'TIPO_QUEJA')
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

test('detecta y expande la descarga SCL delimitada por pipes', () => {
  const row = SCL_HEADERS.map(() => '')
  row[0] = 'CLIENTE-1'

  const workbookRows = [
    [SCL_HEADERS.join('|')],
    [row.join('|')]
  ]

  assert.equal(isSclPipeWorkbook(workbookRows), true)

  const expanded = expandSclPipeRows(workbookRows)

  assert.equal(expanded.length, 2)
  assert.equal(expanded[0].length, 94)
  assert.equal(validateSclHeaders(expanded[0]), true)
  assert.equal(expanded[1][0], 'CLIENTE-1')
})

test('rechaza una fila SCL con campos incompletos', () => {
  assert.throws(
    () => expandSclPipeRows([
      [SCL_HEADERS.join('|')],
      [SCL_HEADERS.slice(0, -1).join('|')]
    ]),
    error => (
      error.code === 'SCL_IMPORT_ROW_FIELD_COUNT'
      && error.details.rowNumber === 2
      && error.details.actual === 93
    )
  )
})

test('transforma SCL y conserva los 94 campos originales', () => {
  const source = Object.fromEntries(
    SCL_HEADERS.map(header => [header, 'N/A'])
  )

  Object.assign(source, {
    CLIENTE_UNICO: '0001234567890',
    NOMBRE_CTE: 'Cliente de prueba',
    GENERO_CLIENTE: 'F',
    EDAD_CLIENTE: '42',
    CP_CTE: '01234',
    CLASIFICACION_CTE: 'ALTO',
    DIAS_ATRASO: '21',
    SALDO_TOTAL: '1,234.50',
    'SALDO REQUERIDO': '500',
    PAGO_NORMAL: '250',
    PRODUCTO: 'PRESTAMO',
    CAMPANIA: 'SEGMENTO-5',
    TELEFONO1: '5512345678',
    TELEFONO2: '0',
    ABONO_SEMANAL: '50'
  })

  const record = transformSclPortfolioRow(source, 9)

  assert.equal(record.identity.idCampania, 'SEGMENTO-5')
  assert.equal(record.identity.idCliente, '0001234567890')
  assert.equal(record.identity.folio, '0001234567890')
  assert.equal(record.snapshot.nombre, 'Cliente de prueba')
  assert.equal(record.snapshot.edad, 42)
  assert.equal(record.snapshot.telefono1, '5512345678')
  assert.equal(record.snapshot.telefono2, null)
  assert.equal(record.snapshot.saldo, 1234.5)
  assert.equal(record.snapshot.pagoRequerido, 500)
  assert.equal(record.snapshot.codigoPostal, '01234')
  assert.equal(Object.keys(record.rawData).length, 94)
  assert.equal(record.rawData.OCUPACION, 'N/A')
})

test('lee un Excel válido sin insertar datos', async () => {
  const row = HEADERS.map(() => '')

  row[0] = 'CAMP-1'
  row[1] = 'CLIENTE-1'
  row[2] = 'Cliente de prueba'
  row[4] = 45
  row[20] = 'FOLIO-1'
  row[21] = 3
  row[22] = 21
  row[24] = 1234.5
  row[25] = 500
  row[26] = 250
  row[27] = 100
  row[28] = 75
  row[29] = 50
  row[30] = '2026-07-29'
  row[31] = '2026-08-15'
  row[33] = '01234'

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
        'CAMP-1'
      )
      assert.equal(
        result.rows[0].CodigoPostal,
        '01234'
      )
    }
  )
})

test('lee directamente una descarga SCL de una columna', async () => {
  const row = SCL_HEADERS.map(() => 'N/A')
  const set = (field, value) => {
    row[SCL_HEADERS.indexOf(field)] = value
  }

  set('CLIENTE_UNICO', '0001234567890')
  set('NOMBRE_CTE', 'Cliente de prueba')
  set('CAMPANIA', 'SEGMENTO-5')
  set('SALDO_TOTAL', '1234.50')
  set('DIAS_ATRASO', '21')

  const buffer = pipeWorkbookBuffer(
    SCL_HEADERS,
    [row]
  )

  await withTemporaryBuffer(
    'Descarga_cartera.xlsx',
    buffer,
    async ({ filePath }) => {
      const result = await readPortfolioWorkbook(
        filePath,
        {
          date: '2026-08-20'
        }
      )

      assert.equal(result.date, '2026-08-20')
      assert.equal(result.format, 'scl_pipe_v1')
      assert.equal(result.headers.length, 94)
      assert.equal(result.totalRows, 1)
      assert.equal(
        result.records[0].identity.idCliente,
        '0001234567890'
      )
      assert.equal(
        Object.keys(result.records[0].rawData).length,
        94
      )
    }
  )
})

test('valida una descarga SCL recibida en memoria', () => {
  const row = SCL_HEADERS.map(() => 'N/A')
  const set = (field, value) => {
    row[SCL_HEADERS.indexOf(field)] = value
  }

  set('CLIENTE_UNICO', '0001234567890')
  set('NOMBRE_CTE', 'Cliente controlado')
  set('CAMPANIA', 'SEGMENTO-5')
  set('SALDO_TOTAL', '950.25')
  set('TELEFONO1', '5512345678')

  const buffer = pipeWorkbookBuffer(
    SCL_HEADERS,
    [row]
  )
  const result = readPortfolioBuffer(
    buffer,
    {
      fileName: 'Descarga_cartera.xlsx',
      date: '2026-08-20'
    }
  )

  assert.equal(result.fileName, 'Descarga_cartera.xlsx')
  assert.equal(result.totalRows, 1)
  assert.equal(result.records[0].snapshot.saldo, 950.25)
  assert.equal(
    result.sha256,
    checksumFor(buffer)
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

test('transforma una fila a tipos compatibles con PostgreSQL', () => {
  const record = transformPortfolioRow({
    IdCampaña: 10,
    IdCliente: '000123456789012345',
    Folio: 'FOLIO-0001',
    Nombre: '  Cliente Controlado  ',
    Edad: '45',
    SemanasAtraso: 3,
    DiasAtraso: '21',
    Saldo: '$1,234.50',
    PagoRequerido: 500,
    PagoMinimo: '250.25',
    PagoNoGeneraIntereses: '',
    AbonoPuntual: '100',
    AbonoSemanal: 50,
    FechaProximaPago: '29/07/2026',
    FechaVencimiento: '2026-08-15',
    CodigoPostal: '01234'
  }, 7)

  assert.equal(record.identity.idCampania, '10')
  assert.equal(
    record.identity.idCliente,
    '000123456789012345'
  )
  assert.equal(
    record.identity.folio,
    'FOLIO-0001'
  )
  assert.equal(
    record.snapshot.nombre,
    'Cliente Controlado'
  )
  assert.equal(record.snapshot.edad, 45)
  assert.equal(record.snapshot.semanasAtraso, 3)
  assert.equal(record.snapshot.diasAtraso, 21)
  assert.equal(record.snapshot.saldo, 1234.5)
  assert.equal(record.snapshot.pagoMinimo, 250.25)
  assert.equal(
    record.snapshot.pagoNoGeneraIntereses,
    null
  )
  assert.equal(
    record.snapshot.fechaProximaPago,
    '2026-07-29'
  )
  assert.equal(
    record.snapshot.fechaVencimiento,
    '2026-08-15'
  )
  assert.equal(record.snapshot.codigoPostal, '01234')
  assert.equal(record.rowNumber, 7)
})

test('convierte valores vacíos a null', () => {
  const record = transformPortfolioRow({
    IdCampaña: 'CAMP-1',
    IdCliente: 'CLIENTE-1',
    Folio: 'FOLIO-1',
    Nombre: '   ',
    Edad: '',
    Saldo: null,
    FechaVencimiento: undefined
  })

  assert.equal(record.snapshot.nombre, null)
  assert.equal(record.snapshot.edad, null)
  assert.equal(record.snapshot.saldo, null)
  assert.equal(
    record.snapshot.fechaVencimiento,
    null
  )
})

test('rechaza una identidad incompleta', () => {
  assert.throws(
    () => transformPortfolioRow({
      IdCampaña: 'CAMP-1',
      IdCliente: ''
    }, 9),
    error => (
      error.code === 'BAZ_IMPORT_REQUIRED_ID_MISSING'
      && error.details.rowNumber === 9
    )
  )
})

test('rechaza enteros fuera del rango permitido', () => {
  assert.throws(
    () => normalizeInteger(
      131,
      'Edad',
      4,
      {
        min: 0,
        max: 130
      }
    ),
    error => (
      error.code === 'BAZ_IMPORT_INTEGER_INVALID'
    )
  )
})

test('rechaza importes no numéricos', () => {
  assert.throws(
    () => normalizeDecimal(
      'importe-desconocido',
      'Saldo',
      5
    ),
    error => (
      error.code === 'BAZ_IMPORT_DECIMAL_INVALID'
    )
  )
})

test('convierte una fecha serial de Excel', () => {
  assert.equal(
    normalizeDate(
      46232,
      'FechaProximaPago',
      2
    ),
    '2026-07-29'
  )
})

test('rechaza fechas de datos imposibles', () => {
  assert.throws(
    () => normalizeDate(
      '31/02/2026',
      'FechaVencimiento',
      6
    ),
    error => (
      error.code === 'BAZ_IMPORT_DATE_VALUE_INVALID'
    )
  )
})

test('rechaza identidades duplicadas dentro del Excel', () => {
  assert.throws(
    () => transformPortfolioRows([
      {
        IdCampaña: 'CAMP-1',
        IdCliente: 'CLIENTE-1',
        Folio: 'FOLIO-1'
      },
      {
        IdCampaña: 'CAMP-1',
        IdCliente: 'CLIENTE-1',
        Folio: 'FOLIO-1'
      }
    ]),
    error => (
      error.code === 'BAZ_IMPORT_DUPLICATE_IDENTITY'
      && error.details.firstRow === 2
      && error.details.duplicateRow === 3
    )
  )
})

test('permite el mismo cliente en campañas distintas', () => {
  const records = transformPortfolioRows([
    {
      IdCampaña: 'CAMP-1',
      IdCliente: 'CLIENTE-1',
      Folio: 'FOLIO-1'
    },
    {
      IdCampaña: 'CAMP-2',
      IdCliente: 'CLIENTE-1',
      Folio: 'FOLIO-1'
    }
  ])

  assert.equal(records.length, 2)
  assert.notEqual(
    records[0].identity.key,
    records[1].identity.key
  )
})
