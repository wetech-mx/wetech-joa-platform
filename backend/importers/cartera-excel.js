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

function isBlank(value) {
  return (
    value === null
    || value === undefined
    || String(value).trim() === ''
  )
}

function normalizeText(value) {
  if (isBlank(value)) {
    return null
  }

  return String(value).trim()
}

function normalizeRequiredIdentifier(
  value,
  field,
  rowNumber
) {
  const normalized = normalizeText(value)

  if (normalized === null) {
    throw new CarteraImportError(
      'BAZ_IMPORT_REQUIRED_ID_MISSING',
      `La fila ${rowNumber} no contiene ${field}`,
      {
        field,
        rowNumber
      }
    )
  }

  return normalized
}

function normalizeInteger(
  value,
  field,
  rowNumber,
  {
    min = Number.MIN_SAFE_INTEGER,
    max = Number.MAX_SAFE_INTEGER
  } = {}
) {
  if (isBlank(value)) {
    return null
  }

  const normalized = (
    typeof value === 'number'
      ? value
      : Number(String(value).trim())
  )

  if (
    !Number.isSafeInteger(normalized)
    || normalized < min
    || normalized > max
  ) {
    throw new CarteraImportError(
      'BAZ_IMPORT_INTEGER_INVALID',
      `La fila ${rowNumber} contiene un entero inválido en ${field}`,
      {
        field,
        rowNumber
      }
    )
  }

  return normalized
}

function normalizeDecimal(value, field, rowNumber) {
  if (isBlank(value)) {
    return null
  }

  const normalized = (
    typeof value === 'number'
      ? value
      : Number(
        String(value)
          .trim()
          .replace(/[$,\s]/g, '')
      )
  )

  if (!Number.isFinite(normalized)) {
    throw new CarteraImportError(
      'BAZ_IMPORT_DECIMAL_INVALID',
      `La fila ${rowNumber} contiene un importe inválido en ${field}`,
      {
        field,
        rowNumber
      }
    )
  }

  return normalized
}

function excelSerialToIsoDate(value) {
  const parsed = XLSX.SSF.parse_date_code(value)

  if (!parsed) {
    return null
  }

  const year = String(parsed.y).padStart(4, '0')
  const month = String(parsed.m).padStart(2, '0')
  const day = String(parsed.d).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function normalizeDate(value, field, rowNumber) {
  if (isBlank(value)) {
    return null
  }

  let normalized

  if (value instanceof Date) {
    normalized = value.toISOString().slice(0, 10)
  } else if (typeof value === 'number') {
    normalized = excelSerialToIsoDate(value)
  } else {
    const text = String(value).trim()
    const latinDate = text.match(
      /^(\d{2})\/(\d{2})\/(\d{4})$/
    )

    normalized = latinDate
      ? `${latinDate[3]}-${latinDate[2]}-${latinDate[1]}`
      : text
  }

  if (!normalized || !isValidIsoDate(normalized)) {
    throw new CarteraImportError(
      'BAZ_IMPORT_DATE_VALUE_INVALID',
      `La fila ${rowNumber} contiene una fecha inválida en ${field}`,
      {
        field,
        rowNumber
      }
    )
  }

  return normalized
}

function transformPortfolioRow(row, rowNumber = 2) {
  const idCampania = normalizeRequiredIdentifier(
    row.IdCampaña,
    'IdCampaña',
    rowNumber
  )
  const idCliente = normalizeRequiredIdentifier(
    row.IdCliente,
    'IdCliente',
    rowNumber
  )

  return {
    identity: {
      idCampania,
      idCliente,
      key: `${idCampania}\u0000${idCliente}`
    },
    snapshot: {
      nombre: normalizeText(row.Nombre),
      idGenero: normalizeText(row.IdGenero),
      edad: normalizeInteger(
        row.Edad,
        'Edad',
        rowNumber,
        {
          min: 0,
          max: 130
        }
      ),
      idNivelRiesgo: normalizeText(
        row.IdNivelRiesgo
      ),
      medioContactoSugerido: normalizeText(
        row.MedioContactoSugerido
      ),
      telefono1: normalizeText(row['Teléfono 1']),
      tipoTelefono1: normalizeText(
        row['Tipo Teléfono 1']
      ),
      telefono2: normalizeText(row['Teléfono 2']),
      tipoTelefono2: normalizeText(
        row['Tipo Teléfono 2']
      ),
      telefono3: normalizeText(row['Teléfono 3']),
      tipoTelefono3: normalizeText(
        row['Tipo Teléfono 3']
      ),
      telefono4: normalizeText(row['Teléfono 4']),
      tipoTelefono4: normalizeText(
        row['Tipo Teléfono 4']
      ),
      correo1: normalizeText(row['Correo 1']),
      correo2: normalizeText(row['Correo 2']),
      idPais: normalizeText(row.IdPais),
      idCanal: normalizeText(row.IdCanal),
      idSucursal: normalizeText(row.IdSucursal),
      folio: normalizeText(row.Folio),
      semanasAtraso: normalizeInteger(
        row.SemanasAtraso,
        'SemanasAtraso',
        rowNumber,
        {
          min: 0
        }
      ),
      diasAtraso: normalizeInteger(
        row.DiasAtraso,
        'DiasAtraso',
        rowNumber,
        {
          min: 0
        }
      ),
      diaPago: normalizeText(row.DiaPago),
      saldo: normalizeDecimal(
        row.Saldo,
        'Saldo',
        rowNumber
      ),
      pagoRequerido: normalizeDecimal(
        row.PagoRequerido,
        'PagoRequerido',
        rowNumber
      ),
      pagoMinimo: normalizeDecimal(
        row.PagoMinimo,
        'PagoMinimo',
        rowNumber
      ),
      pagoNoGeneraIntereses: normalizeDecimal(
        row.PagoNoGeneraIntereses,
        'PagoNoGeneraIntereses',
        rowNumber
      ),
      abonoPuntual: normalizeDecimal(
        row.AbonoPuntual,
        'AbonoPuntual',
        rowNumber
      ),
      abonoSemanal: normalizeDecimal(
        row.AbonoSemanal,
        'AbonoSemanal',
        rowNumber
      ),
      fechaProximaPago: normalizeDate(
        row.FechaProximaPago,
        'FechaProximaPago',
        rowNumber
      ),
      fechaVencimiento: normalizeDate(
        row.FechaVencimiento,
        'FechaVencimiento',
        rowNumber
      ),
      producto: normalizeText(row.Producto),
      codigoPostal: normalizeText(
        row.CodigoPostal
      )
    },
    rawData: {
      ...row
    },
    rowNumber
  }
}

function transformPortfolioRows(rows) {
  const transformed = []
  const identities = new Map()

  for (let index = 0; index < rows.length; index++) {
    const rowNumber = index + 2
    const record = transformPortfolioRow(
      rows[index],
      rowNumber
    )
    const previousRow = identities.get(
      record.identity.key
    )

    if (previousRow) {
      throw new CarteraImportError(
        'BAZ_IMPORT_DUPLICATE_IDENTITY',
        `Las filas ${previousRow} y ${rowNumber} repiten IdCampaña + IdCliente`,
        {
          firstRow: previousRow,
          duplicateRow: rowNumber,
          idCampania: record.identity.idCampania,
          idCliente: record.identity.idCliente
        }
      )
    }

    identities.set(
      record.identity.key,
      rowNumber
    )
    transformed.push(record)
  }

  return transformed
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

  const rawRows = dataRows.map(rowToObject)

  return {
    date,
    fileName: path.basename(filePath),
    sha256: checksumFor(buffer),
    headers: [...HEADERS],
    rows: rawRows,
    records: transformPortfolioRows(rawRows),
    totalRows: dataRows.length
  }
}

module.exports = {
  CarteraImportError,
  checksumFor,
  isValidIsoDate,
  normalizeDate,
  normalizeDecimal,
  normalizeInteger,
  parsePortfolioDate,
  readPortfolioWorkbook,
  transformPortfolioRow,
  transformPortfolioRows,
  validateHeaders
}
