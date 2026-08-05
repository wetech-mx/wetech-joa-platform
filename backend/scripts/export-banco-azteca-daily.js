const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const {
  exportPortfolio
} = require('../integrations/banco-azteca/service')
const {
  buildBancoAztecaRuntimeEnvironment,
  secretReferenceFrom
} = require(
  '../integrations/banco-azteca/runtime-environment'
)
const {
  classifyExportResult,
  monitorBancoAztecaExecution,
  parseCompanyId
} = require(
  '../integrations/banco-azteca/execution-monitor'
)

const DEFAULT_TIME_ZONE = 'America/Mexico_City'
const DEFAULT_OUTBOX = '/srv/banco-azteca-transfer/outbox'
const FILE_PREFIX = 'Cartera_BancoAzteca_'

function datePartsInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  )

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  }
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10)
}

function parseHolidays(value = '') {
  const holidays = new Set()

  for (const item of String(value).split(',')) {
    const date = item.trim()

    if (!date) {
      continue
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(
        `BAZ_HOLIDAYS contiene una fecha inválida: ${date}`
      )
    }

    holidays.add(date)
  }

  return holidays
}

function previousBusinessDay(
  now = new Date(),
  {
    timeZone = DEFAULT_TIME_ZONE,
    holidays = new Set()
  } = {}
) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('La fecha actual no es válida')
  }

  const local = datePartsInTimeZone(now, timeZone)
  const candidate = new Date(
    Date.UTC(local.year, local.month - 1, local.day)
  )

  do {
    candidate.setUTCDate(candidate.getUTCDate() - 1)
  } while (
    candidate.getUTCDay() === 0 ||
    candidate.getUTCDay() === 6 ||
    holidays.has(formatUtcDate(candidate))
  )

  return formatUtcDate(candidate)
}

function portfolioFileName(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
    throw new Error('La fecha del archivo no es válida')
  }

  return `${FILE_PREFIX}${date}.xlsx`
}

async function regularNonEmptyFile(filePath) {
  try {
    const stats = await fs.promises.lstat(filePath)
    return stats.isFile() && stats.size > 0
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false
    }

    throw error
  }
}

async function writeAtomic(filePath, content) {
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.partial`
  )

  let handle

  try {
    handle = await fs.promises.open(
      temporaryPath,
      fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_WRONLY,
      0o640
    )
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    handle = undefined

    await fs.promises.rename(temporaryPath, filePath)
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {})
    }

    await fs.promises.unlink(temporaryPath).catch(() => {})
    throw error
  }
}

function checksumFor(buffer) {
  return crypto
    .createHash('sha256')
    .update(buffer)
    .digest('hex')
}

async function ensureChecksum(filePath, buffer) {
  const checksumPath = `${filePath}.sha256`

  if (await regularNonEmptyFile(checksumPath)) {
    return checksumPath
  }

  const safeBuffer = buffer || await fs.promises.readFile(filePath)
  const checksum = checksumFor(safeBuffer)
  const contents = `${checksum}  ${path.basename(filePath)}\n`

  await writeAtomic(checksumPath, contents)
  return checksumPath
}

async function generateDailyPortfolio({
  now = new Date(),
  env = process.env,
  exportFn = exportPortfolio
} = {}) {
  const timeZone =
    String(env.BAZ_EXPORT_TIME_ZONE || DEFAULT_TIME_ZONE).trim()
  const holidays = parseHolidays(env.BAZ_HOLIDAYS)
  const date = String(env.BAZ_EXPORT_DATE || '').trim() ||
    previousBusinessDay(now, { timeZone, holidays })
  const outbox = path.resolve(
    String(env.BAZ_EXPORT_OUTBOX || DEFAULT_OUTBOX).trim()
  )
  const fileName = portfolioFileName(date)
  const filePath = path.join(outbox, fileName)

  const outboxStats = await fs.promises.lstat(outbox)
  if (!outboxStats.isDirectory()) {
    throw new Error('El outbox de Banco Azteca no es un directorio')
  }

  if (await regularNonEmptyFile(filePath)) {
    const checksumPath = await ensureChecksum(filePath)

    return {
      status: 'already_exists',
      date,
      fileName,
      filePath,
      checksumPath
    }
  }

  const result = await exportFn(date, { env })

  if (!Buffer.isBuffer(result?.buffer) || result.buffer.length === 0) {
    throw new Error('Banco Azteca no generó un Excel válido')
  }

  await writeAtomic(filePath, result.buffer)
  const checksumPath = await ensureChecksum(filePath, result.buffer)

  return {
    status: 'generated',
    date,
    fileName,
    filePath,
    checksumPath,
    campaigns: result.campaigns,
    clients: result.clients,
    bytes: result.buffer.length
  }
}

async function runCli({
  env = process.env,
  pool,
  generateFn = generateDailyPortfolio,
  monitorFn = monitorBancoAztecaExecution
} = {}) {
  if (!secretReferenceFrom(env)) {
    const envFile = env.BANCO_AZTECA_ENV_FILE ||
      path.join(__dirname, '..', '.env')

    require('dotenv').config({
      path: envFile,
      quiet: true
    })
  }

  const runtime = buildBancoAztecaRuntimeEnvironment({
    env
  })
  const activePool = pool || require('../config/database')
  const ownsPool = !pool
  const empresaId = parseCompanyId(
    runtime.env.BAZ_IMPORT_EMPRESA_ID
  )

  process.umask(0o027)

  console.log(
    `BANCO_AZTECA_CONFIG_SOURCE=${runtime.mode}`
  )
  console.log('BANCO_AZTECA_SECRET_SHOWN=NO')

  try {
    const result = await monitorFn({
      pool: activePool,
      empresaId,
      stage: 'extraccion',
      classifyResult: classifyExportResult,
      fallbackErrorCode: 'BAZ_EXPORT_UNEXPECTED',
      operation: () => generateFn({
        env: runtime.env
      })
    })

    console.log(JSON.stringify(result))
    return result
  } finally {
    if (ownsPool) {
      await activePool.end()
    }
  }
}

if (require.main === module) {
  runCli().catch(error => {
    console.error('BANCO_AZTECA_DAILY_EXPORT_ERROR', {
      code: error.code || 'BAZ_EXPORT_UNEXPECTED'
    })
    process.exitCode = 1
  })
}

module.exports = {
  DEFAULT_OUTBOX,
  DEFAULT_TIME_ZONE,
  checksumFor,
  generateDailyPortfolio,
  parseHolidays,
  portfolioFileName,
  previousBusinessDay,
  runCli,
  writeAtomic
}
