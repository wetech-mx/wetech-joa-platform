'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const {
  readPortfolioWorkbook
} = require('../importers/cartera-excel')
const {
  persistPortfolio
} = require('../importers/cartera-repository')
const {
  parseHolidays,
  previousBusinessDay
} = require('./export-banco-azteca-daily')

const DEFAULT_TIME_ZONE = 'America/Mexico_City'
const FILE_PREFIX = 'Cartera_BancoAzteca_'

class CarteraDailyImportError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'CarteraDailyImportError'
    this.code = code
    this.details = details
  }
}

function parsePositiveInteger(
  value,
  variableName,
  {
    required = true
  } = {}
) {
  if (
    !required
    && (
      value === undefined
      || value === null
      || String(value).trim() === ''
    )
  ) {
    return null
  }

  const normalized = String(value ?? '').trim()

  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new CarteraDailyImportError(
      'BAZ_IMPORT_ENV_INTEGER_INVALID',
      `${variableName} debe ser un entero positivo`,
      {
        variable: variableName
      }
    )
  }

  const parsed = Number(normalized)

  if (!Number.isSafeInteger(parsed)) {
    throw new CarteraDailyImportError(
      'BAZ_IMPORT_ENV_INTEGER_INVALID',
      `${variableName} está fuera del rango permitido`,
      {
        variable: variableName
      }
    )
  }

  return parsed
}

function validateIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    return false
  }

  const date = new Date(`${value}T00:00:00Z`)

  return (
    !Number.isNaN(date.getTime())
    && date.toISOString().slice(0, 10) === value
  )
}

function resolvePortfolioDate({
  now = new Date(),
  env = process.env
} = {}) {
  const explicitDate = String(
    env.BAZ_EXPORT_DATE || ''
  ).trim()

  if (explicitDate) {
    if (!validateIsoDate(explicitDate)) {
      throw new CarteraDailyImportError(
        'BAZ_IMPORT_DATE_INVALID',
        'BAZ_EXPORT_DATE debe usar el formato AAAA-MM-DD'
      )
    }

    return explicitDate
  }

  return previousBusinessDay(
    now,
    {
      timeZone:
        env.BAZ_EXPORT_TIME_ZONE
        || DEFAULT_TIME_ZONE,
      holidays: parseHolidays(
        env.BAZ_HOLIDAYS || ''
      )
    }
  )
}

function resolvePortfolioPaths({
  env = process.env,
  now = new Date()
} = {}) {
  const outbox = String(
    env.BAZ_EXPORT_OUTBOX || ''
  ).trim()

  if (!outbox || !path.isAbsolute(outbox)) {
    throw new CarteraDailyImportError(
      'BAZ_IMPORT_OUTBOX_INVALID',
      'BAZ_EXPORT_OUTBOX debe ser una ruta absoluta'
    )
  }

  const date = resolvePortfolioDate({
    now,
    env
  })
  const fileName = `${FILE_PREFIX}${date}.xlsx`
  const filePath = path.join(outbox, fileName)

  return {
    date,
    fileName,
    filePath,
    checksumPath: `${filePath}.sha256`
  }
}

function parseChecksumDocument(
  content,
  expectedFileName
) {
  const normalized = String(content || '').trim()
  const match = normalized.match(
    /^([0-9a-f]{64})[ \t]+[*]?(.+)$/i
  )

  if (!match) {
    throw new CarteraDailyImportError(
      'BAZ_IMPORT_CHECKSUM_FORMAT_INVALID',
      'El archivo SHA-256 tiene un formato inválido'
    )
  }

  const sha256 = match[1].toLowerCase()
  const referencedFileName = match[2].trim()

  if (referencedFileName !== expectedFileName) {
    throw new CarteraDailyImportError(
      'BAZ_IMPORT_CHECKSUM_FILENAME_MISMATCH',
      'El SHA-256 hace referencia a otro archivo',
      {
        expectedFileName,
        referencedFileName
      }
    )
  }

  return sha256
}

function hashesMatch(left, right) {
  if (
    !/^[0-9a-f]{64}$/i.test(left || '')
    || !/^[0-9a-f]{64}$/i.test(right || '')
  ) {
    return false
  }

  return crypto.timingSafeEqual(
    Buffer.from(left.toLowerCase(), 'hex'),
    Buffer.from(right.toLowerCase(), 'hex')
  )
}

async function importDailyPortfolio({
  env = process.env,
  now = new Date(),
  pool,
  readFileFn = fs.promises.readFile,
  readPortfolioFn = readPortfolioWorkbook,
  persistFn = persistPortfolio
} = {}) {
  const empresaId = parsePositiveInteger(
    env.BAZ_IMPORT_EMPRESA_ID,
    'BAZ_IMPORT_EMPRESA_ID'
  )
  const creadoPor = parsePositiveInteger(
    env.BAZ_IMPORT_USER_ID,
    'BAZ_IMPORT_USER_ID',
    {
      required: false
    }
  )
  const paths = resolvePortfolioPaths({
    env,
    now
  })

  let checksumDocument

  try {
    checksumDocument = await readFileFn(
      paths.checksumPath,
      'utf8'
    )
  } catch (error) {
    throw new CarteraDailyImportError(
      'BAZ_IMPORT_CHECKSUM_NOT_FOUND',
      'No se pudo leer el archivo SHA-256',
      {
        reason: error.code || error.name
      }
    )
  }

  const expectedHash = parseChecksumDocument(
    checksumDocument,
    paths.fileName
  )

  let portfolio

  try {
    portfolio = await readPortfolioFn(
      paths.filePath
    )
  } catch (error) {
    if (
      error
      && /^BAZ_/.test(error.code || '')
    ) {
      throw error
    }

    throw new CarteraDailyImportError(
      'BAZ_IMPORT_WORKBOOK_READ_FAILED',
      'No se pudo leer el Excel de cartera',
      {
        reason: error.code || error.name
      }
    )
  }

  if (
    portfolio.date !== paths.date
    || portfolio.fileName !== paths.fileName
  ) {
    throw new CarteraDailyImportError(
      'BAZ_IMPORT_WORKBOOK_IDENTITY_MISMATCH',
      'La identidad del Excel no coincide con la cartera esperada'
    )
  }

  if (
    !hashesMatch(
      expectedHash,
      portfolio.sha256
    )
  ) {
    throw new CarteraDailyImportError(
      'BAZ_IMPORT_CHECKSUM_MISMATCH',
      'La verificación SHA-256 del Excel falló'
    )
  }

  const result = await persistFn({
    pool,
    empresaId,
    portfolio,
    creadoPor
  })

  return {
    ...result,
    date: paths.date,
    fileName: paths.fileName,
    sha256: portfolio.sha256,
    empresaId
  }
}

async function runCli() {
  require('dotenv').config()

  const pool = require('../config/database')

  try {
    const result = await importDailyPortfolio({
      env: process.env,
      pool
    })

    console.log('BANCO_AZTECA_DAILY_IMPORT_OK', {
      status: result.status,
      date: result.date,
      fileName: result.fileName,
      empresaId: result.empresaId,
      importacionId: result.importacionId,
      campaigns: result.campaigns,
      totalRows: result.totalRows,
      newRecords: result.newRecords,
      updatedRecords: result.updatedRecords,
      assignedRecords: result.assignedRecords,
      keptAssignments: result.keptAssignments
    })
  } catch (error) {
    console.error('BANCO_AZTECA_DAILY_IMPORT_ERROR', {
      code: error.code || 'BAZ_IMPORT_UNEXPECTED',
      message: error.message
    })
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

if (require.main === module) {
  runCli()
}

module.exports = {
  CarteraDailyImportError,
  hashesMatch,
  importDailyPortfolio,
  parseChecksumDocument,
  parsePositiveInteger,
  resolvePortfolioDate,
  resolvePortfolioPaths,
  validateIsoDate
}
