const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const XLSX = require('xlsx')

const {
  HEADERS
} = require('../integrations/banco-azteca/excel')

const SCL_HEADERS = Object.freeze([
  'CLIENTE_UNICO',
  'NOMBRE_CTE',
  'GENERO_CLIENTE',
  'EDAD_CLIENTE',
  'OCUPACION',
  'DIRECCION_CTE',
  'NUM_EXT_CTE',
  'NUM_INT_CTE',
  'CP_CTE',
  'COLONIA_CTE',
  'POBLACION_CTE',
  'ESTADO_CTE',
  'TERRITORIO',
  'TERRITORIAL',
  'ZONA',
  'ZONAL',
  'NOMBRE_DESPACHO',
  'GERENCIA',
  'FECHA_ASIGNACION',
  'DIAS_ASIGNACION',
  'REFERENCIAS_DOMICILIO',
  'CLASIFICACION_CTE',
  'DIQUE',
  'ATRASO_MAXIMO',
  'DIAS_ATRASO',
  'SALDO',
  'MORATORIOS',
  'SALDO_TOTAL',
  'SALDO ATRASADO',
  'SALDO REQUERIDO',
  'PAGO_NORMAL',
  'PRODUCTO',
  'ESTRATEGIA',
  'FECHA_ULTIMO_PAGO',
  'IMP_ULTIMO_PAGO',
  'CALLE_EMPLEO',
  'NUM_EXT_EMPLEO',
  'NUM_INT_EMPLEO',
  'COLONIA_EMPLEO',
  'POBLACION_EMPLEO',
  'ESTADO_EMPLEO',
  'NOMBRE_AVAL',
  'TEL_AVAL',
  'CALLE_AVAL',
  'NUM_EXT_AVAL',
  'COLONIA_AVAL',
  'CP_AVAL',
  'POBLACION_AVAL',
  'ESTADO_AVAL',
  'FIDIAPAGO',
  'TELEFONO1',
  'TELEFONO2',
  'TELEFONO3',
  'TELEFONO4',
  'TIPOTEL1',
  'TIPOTEL2',
  'TIPOTEL3',
  'TIPOTEL4',
  'LATITUD',
  'LONGITUD',
  'DESPACHO_GESTIONO',
  'ULTIMA_GESTION',
  'GESTION_DESC',
  'CAMPANIA_RELAMPAGO',
  'CAMPANIA',
  'PREVENTA',
  'ID_GRUPO',
  'GRUPO_MAZ',
  'CLAVE_SPEI',
  'PAGOS_CLIENTE',
  'MONTO_PAGOS',
  'GESTORES',
  'FOLIO_PLAN',
  'SEGMENTO_GENERACION',
  'ESTATUS_PLAN',
  'SEMANAS_ATRASO',
  'ATRASO',
  'GENERACION_PLAN',
  'CANCELACION_CUMPLIMIENTO_PLAN',
  'ULTIMO_ESTATUS',
  'EMPLEADO',
  'CANAL',
  'ABONO_SEMANAL',
  'PLAZO',
  'MONTO_ABONADO',
  'MONTO_PLAN',
  'ENGANCHE',
  'PAGOS_RECIBIDOS',
  'SALDO_ANTES_DEL_PLAN',
  'SALDO_ATRASADO_ANTES_PLAN',
  'MORATORIOS_ANTES_PLAN',
  'ESTATUS_PROMESA_PAGO',
  'MONTO_PROMESA_PAGO',
  'TIPO_QUEJA'
])

const SOURCE_EMPTY_VALUES = new Set([
  '',
  'N/A',
  'NA',
  'N.D.',
  'ND',
  'NULL',
  'SIN DATO',
  'SIN DATOS',
  'SIN INFORMACION',
  'SIN INFORMACIÓN',
  'NO APLICA',
  '-'
])

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

function validateSclHeaders(actualHeaders) {
  if (!Array.isArray(actualHeaders)) {
    throw new CarteraImportError(
      'SCL_IMPORT_HEADERS_INVALID',
      'No fue posible leer los encabezados de la descarga SCL'
    )
  }

  if (actualHeaders.length !== SCL_HEADERS.length) {
    throw new CarteraImportError(
      'SCL_IMPORT_HEADER_COUNT',
      `La descarga SCL debe contener exactamente ${SCL_HEADERS.length} campos`,
      {
        expected: SCL_HEADERS.length,
        actual: actualHeaders.length
      }
    )
  }

  for (let index = 0; index < SCL_HEADERS.length; index++) {
    const expected = SCL_HEADERS[index]
    const actual = actualHeaders[index]

    if (actual !== expected) {
      throw new CarteraImportError(
        'SCL_IMPORT_HEADER_MISMATCH',
        `El campo ${index + 1} debe ser "${expected}"`,
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

function isSclPipeWorkbook(rows) {
  return (
    Array.isArray(rows)
    && rows.length > 0
    && Array.isArray(rows[0])
    && rows[0].length === 1
    && typeof rows[0][0] === 'string'
    && rows[0][0].includes('|')
  )
}

function expandSclPipeRows(rows) {
  if (!isSclPipeWorkbook(rows)) {
    throw new CarteraImportError(
      'SCL_IMPORT_FORMAT_INVALID',
      'La descarga SCL no contiene registros separados por |'
    )
  }

  return rows.map((row, index) => {
    const fields = String(row[0] ?? '').split('|')

    if (fields.length !== SCL_HEADERS.length) {
      throw new CarteraImportError(
        'SCL_IMPORT_ROW_FIELD_COUNT',
        `La fila ${index + 1} debe contener ${SCL_HEADERS.length} campos separados por |`,
        {
          rowNumber: index + 1,
          expected: SCL_HEADERS.length,
          actual: fields.length
        }
      )
    }

    return fields
  })
}

function resolvePortfolioDate(
  filePath,
  explicitDate
) {
  if (explicitDate !== undefined && explicitDate !== null) {
    const date = String(explicitDate).trim()

    if (!isValidIsoDate(date)) {
      throw new CarteraImportError(
        'BAZ_IMPORT_DATE_INVALID',
        'La fecha indicada para la cartera no es válida',
        {
          date
        }
      )
    }

    return date
  }

  return parsePortfolioDate(filePath)
}

function isNonEmptyRow(row) {
  return row.some(value => (
    value !== null
    && value !== undefined
    && String(value).trim() !== ''
  ))
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

function normalizeSourceText(value) {
  if (isBlank(value)) {
    return null
  }

  const text = String(value).trim()

  return SOURCE_EMPTY_VALUES.has(text.toUpperCase())
    ? null
    : text
}

function normalizeSourcePhone(value) {
  const text = normalizeSourceText(value)

  if (
    text === null
    || /^0+$/.test(text.replace(/\D/g, ''))
  ) {
    return null
  }

  return text
}

function normalizeSourceInteger(
  value,
  field,
  rowNumber,
  options
) {
  const text = normalizeSourceText(value)

  return text === null
    ? null
    : normalizeInteger(
      text.replace(/,/g, ''),
      field,
      rowNumber,
      options
    )
}

function normalizeSourceDecimal(
  value,
  field,
  rowNumber
) {
  const text = normalizeSourceText(value)

  return text === null
    ? null
    : normalizeDecimal(text, field, rowNumber)
}

function transformSclPortfolioRow(
  row,
  rowNumber = 2
) {
  const idCliente = normalizeRequiredIdentifier(
    normalizeSourceText(row.CLIENTE_UNICO),
    'CLIENTE_UNICO',
    rowNumber
  )
  const idCampania = (
    normalizeSourceText(row.CAMPANIA)
    || normalizeSourceText(row.SEGMENTO_GENERACION)
    || 'SCL'
  )
  const folio = idCliente

  return {
    identity: {
      idCampania,
      idCliente,
      folio,
      key: [
        idCampania,
        idCliente,
        folio
      ].join('\u0000')
    },
    snapshot: {
      nombre: normalizeSourceText(row.NOMBRE_CTE),
      idGenero: normalizeSourceText(row.GENERO_CLIENTE),
      edad: normalizeSourceInteger(
        row.EDAD_CLIENTE,
        'EDAD_CLIENTE',
        rowNumber,
        {
          min: 0,
          max: 130
        }
      ),
      idNivelRiesgo: normalizeSourceText(
        row.CLASIFICACION_CTE
      ),
      medioContactoSugerido: (
        normalizeSourceText(row.ESTRATEGIA)
        || normalizeSourceText(row.CANAL)
      ),
      telefono1: normalizeSourcePhone(row.TELEFONO1),
      tipoTelefono1: normalizeSourceText(row.TIPOTEL1),
      telefono2: normalizeSourcePhone(row.TELEFONO2),
      tipoTelefono2: normalizeSourceText(row.TIPOTEL2),
      telefono3: normalizeSourcePhone(row.TELEFONO3),
      tipoTelefono3: normalizeSourceText(row.TIPOTEL3),
      telefono4: normalizeSourcePhone(row.TELEFONO4),
      tipoTelefono4: normalizeSourceText(row.TIPOTEL4),
      correo1: null,
      correo2: null,
      idPais: 'MX',
      idCanal: normalizeSourceText(row.CANAL),
      idSucursal: (
        normalizeSourceText(row.ZONA)
        || normalizeSourceText(row.TERRITORIO)
      ),
      folio,
      semanasAtraso: normalizeSourceInteger(
        row.SEMANAS_ATRASO,
        'SEMANAS_ATRASO',
        rowNumber
      ),
      diasAtraso: normalizeSourceInteger(
        row.DIAS_ATRASO,
        'DIAS_ATRASO',
        rowNumber
      ),
      diaPago: normalizeSourceText(row.FIDIAPAGO),
      saldo: normalizeSourceDecimal(
        row.SALDO_TOTAL,
        'SALDO_TOTAL',
        rowNumber
      ),
      pagoRequerido: normalizeSourceDecimal(
        row['SALDO REQUERIDO'],
        'SALDO REQUERIDO',
        rowNumber
      ),
      pagoMinimo: normalizeSourceDecimal(
        row.PAGO_NORMAL,
        'PAGO_NORMAL',
        rowNumber
      ),
      pagoNoGeneraIntereses: null,
      abonoPuntual: null,
      abonoSemanal: normalizeSourceDecimal(
        row.ABONO_SEMANAL,
        'ABONO_SEMANAL',
        rowNumber
      ),
      fechaProximaPago: null,
      fechaVencimiento: null,
      producto: normalizeSourceText(row.PRODUCTO),
      codigoPostal: normalizeSourceText(row.CP_CTE)
    },
    rawData: {
      ...row
    },
    rowNumber
  }
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
  const folio = normalizeRequiredIdentifier(
    row.Folio,
    'Folio',
    rowNumber
  )

  return {
    identity: {
      idCampania,
      idCliente,
      folio,
      key: [
        idCampania,
        idCliente,
        folio
      ].join('\u0000')
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
      folio,
      semanasAtraso: normalizeInteger(
        row.SemanasAtraso,
        'SemanasAtraso',
        rowNumber
      ),
      diasAtraso: normalizeInteger(
        row.DiasAtraso,
        'DiasAtraso',
        rowNumber
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

function transformRowsWith(
  rows,
  transformer
) {
  const transformed = []
  const identities = new Map()

  for (let index = 0; index < rows.length; index++) {
    const rowNumber = index + 2
    const record = transformer(
      rows[index],
      rowNumber
    )
    const previousRow = identities.get(
      record.identity.key
    )

    if (previousRow) {
      throw new CarteraImportError(
        'BAZ_IMPORT_DUPLICATE_IDENTITY',
        `Las filas ${previousRow} y ${rowNumber} repiten IdCampaña + IdCliente + Folio`,
        {
          firstRow: previousRow,
          duplicateRow: rowNumber,
          idCampania: record.identity.idCampania,
          idCliente: record.identity.idCliente,
          folio: record.identity.folio
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

function transformPortfolioRows(rows) {
  return transformRowsWith(
    rows,
    transformPortfolioRow
  )
}

function transformSclPortfolioRows(rows) {
  return transformRowsWith(
    rows,
    transformSclPortfolioRow
  )
}

async function readPortfolioWorkbook(
  filePath,
  options = {}
) {
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

  const workbookRows = XLSX.utils.sheet_to_json(
    workbook.Sheets[sheetName],
    {
      header: 1,
      raw: true,
      defval: '',
      blankrows: false
    }
  )

  if (workbookRows.length === 0) {
    throw new CarteraImportError(
      'BAZ_IMPORT_WORKBOOK_EMPTY',
      'El Excel no contiene encabezados'
    )
  }

  const isScl = isSclPipeWorkbook(workbookRows)
  const rows = isScl
    ? expandSclPipeRows(workbookRows)
    : workbookRows
  const headers = isScl
    ? SCL_HEADERS
    : HEADERS

  if (isScl) {
    validateSclHeaders(rows[0])
  } else {
    validateHeaders(rows[0])
  }

  const date = resolvePortfolioDate(
    filePath,
    options.date
  )

  const dataRows = rows
    .slice(1)
    .filter(isNonEmptyRow)

  if (dataRows.length === 0) {
    throw new CarteraImportError(
      'BAZ_IMPORT_NO_DATA',
      'El Excel no contiene registros de cartera'
    )
  }

  const rawRows = dataRows.map(row => (
    Object.fromEntries(
      headers.map((header, index) => [
        header,
        row[index] ?? ''
      ])
    )
  ))
  const records = isScl
    ? transformSclPortfolioRows(rawRows)
    : transformPortfolioRows(rawRows)

  return {
    date,
    fileName: path.basename(filePath),
    sha256: checksumFor(buffer),
    format: isScl ? 'scl_pipe_v1' : 'normalized_v1',
    headers: [...headers],
    rows: rawRows,
    records,
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
  resolvePortfolioDate,
  SCL_HEADERS,
  expandSclPipeRows,
  isSclPipeWorkbook,
  transformPortfolioRow,
  transformPortfolioRows,
  transformSclPortfolioRow,
  transformSclPortfolioRows,
  validateHeaders,
  validateSclHeaders
}
