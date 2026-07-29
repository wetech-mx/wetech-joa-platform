const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const XLSX = require('xlsx')

const {
  HEADERS
} = require('../integrations/banco-azteca/excel')

class CarteraImportError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'CarteraImportError'
    this.code = code
    this.details = details
  }
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const [year, month, day] = value
    .split('-')
    .map(Number)
  const date = new Date(Date.UTC(
    year,
    month - 1,
    day
  ))

  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  )
}

function parsePortfolioDate(filePath) {
  const fileName = path.basename(filePath)
  const match = fileName.match(
    /^Cartera_BancoAzteca_(\d{4}-\d{2}-\d{2})\.xlsx$/
  )

  if (!match) {
    throw new CarteraImportError(
      'BAZ_IMPORT_FILE_NAME_INVALID',
      'El archivo no cumple el formato Cartera_BancoAzteca_YYYY-MM-DD.xlsx',
      {
        fileName
      }
    )
  }

  if (!isValidIsoDate(match[1])) {
    throw new CarteraImportError(
      'BAZ_IMPORT_DATE_INVALID',
      'La fecha incluida en el nombre del archivo no es válida',
      {
        fileName,
        date: match[1]
      }
    )
  }

  return match[1]
}

function checksumFor(buffer) {
  return crypto
    .createHash('sha256')
    .update(buffer)
    .digest('hex')
}

function validateHeaders(actualHeaders) {
  if (!Array.isArray(actualHeaders)) {
    throw new CarteraImportError(
      'BAZ_IMPORT_HEADERS_INVALID',
      'No fue posible leer los encabezados del Excel'
    )
  }

  if (actualHeaders.length !== HEADERS.length) {
    throw new CarteraImportError(
      'BAZ_IMPORT_HEADER_COUNT',
      `El Excel debe contener exactamente ${HEADERS.length} columnas`,
      {
        expected: HEADERS.length,
        actual: actualHeaders.length
      }
    )
  }

  for (let index = 0; index < HEADERS.length; index++) {
    const expected = HEADERS[index]
    const actual = actualHeaders[index]

    if (actual !== expected) {
      throw new CarteraImportError(
        'BAZ_IMPORT_HEADER_MISMATCH',
        `La columna ${index + 1} debe ser "${expected}"`,
        {
          column: index + 1,
          expected,
          actual
        }
      )
    }
  }

  return true
}

function isNonEmptyRow(row) {
  return row.some(value => (
    value !== null
    && value !== undefined
    && String(value).trim() !== ''
  ))
}

function rowToObject(row) {
  return Object.fromEntries(
    HEADERS.map((header, index) => [
      header,
      row[index] ?? ''
    ])
  )
}

async function readPortfolioWorkbook(filePath) {
  const date = parsePortfolioDate(filePath)
  const buffer = await fs.promises.readFile(filePath)
  let workbook

  try {
    workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: false
    })
  } catch (error) {
    throw new CarteraImportError(
      'BAZ_IMPORT_WORKBOOK_INVALID',
      'El archivo no es un Excel válido',
      {
        reason: error.message
      }
    )
  }

  const sheetName = workbook.SheetNames[0]

  if (!sheetName) {
    throw new CarteraImportError(
      'BAZ_IMPORT_WORKBOOK_EMPTY',
      'El Excel no contiene hojas'
    )
  }

  const rows = XLSX.utils.sheet_to_json(
    workbook.Sheets[sheetName],
    {
      header: 1,
      raw: true,
      defval: '',
      blankrows: false
    }
  )

  if (rows.length === 0) {
    throw new CarteraImportError(
      'BAZ_IMPORT_WORKBOOK_EMPTY',
      'El Excel no contiene encabezados'
    )
  }

  validateHeaders(rows[0])

  const dataRows = rows
    .slice(1)
    .filter(isNonEmptyRow)

  if (dataRows.length === 0) {
    throw new CarteraImportError(
      'BAZ_IMPORT_NO_DATA',
      'El Excel no contiene registros de cartera'
    )
  }

  return {
    date,
    fileName: path.basename(filePath),
    sha256: checksumFor(buffer),
    headers: [...HEADERS],
    rows: dataRows.map(rowToObject),
    totalRows: dataRows.length
  }
}

module.exports = {
  CarteraImportError,
  checksumFor,
  isValidIsoDate,
  parsePortfolioDate,
  readPortfolioWorkbook,
  validateHeaders
}
