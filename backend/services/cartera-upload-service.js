const crypto = require('node:crypto')

const {
  CarteraImportError,
  readPortfolioBuffer
} = require('../importers/cartera-excel')
const {
  CarteraPersistenceError,
  persistPortfolio
} = require('../importers/cartera-repository')

const JOB_TTL_MS = 30 * 60 * 1000
const importJobs = new Map()

class CarteraUploadError extends Error {
  constructor(
    code,
    message,
    status = 400
  ) {
    super(message)
    this.name = 'CarteraUploadError'
    this.code = code
    this.status = status
  }
}

function normalizePositiveId(
  value,
  code,
  message
) {
  const text = String(value ?? '').trim()

  if (!/^[1-9]\d*$/.test(text)) {
    throw new CarteraUploadError(
      code,
      message
    )
  }

  return text
}

function resolveCompanyId(usuario) {
  const value = Number(usuario?.empresa_id)

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CarteraUploadError(
      'CARTERA_IMPORT_COMPANY_REQUIRED',
      'La sesión no contiene una empresa válida',
      403
    )
  }

  return value
}

function resolveUserId(usuario) {
  const value = Number(usuario?.id)

  return Number.isSafeInteger(value) && value > 0
    ? value
    : null
}

async function resolveImportTarget({
  pool,
  usuario,
  originId
}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new CarteraUploadError(
      'CARTERA_IMPORT_POOL_INVALID',
      'La conexión de datos no está disponible',
      500
    )
  }

  const empresaId = resolveCompanyId(usuario)
  const normalizedOriginId = normalizePositiveId(
    originId,
    'CARTERA_IMPORT_ORIGIN_REQUIRED',
    'Seleccione el origen de la cartera'
  )
  const result = await pool.query(
    `
    SELECT
      o.id AS origen_id,
      o.codigo AS origen_codigo,
      o.nombre AS origen_nombre,
      i.id AS integracion_id,
      i.nombre AS integracion_nombre
    FROM public.crm_origenes o
    INNER JOIN public.crm_integraciones i
      ON i.empresa_id = o.empresa_id
      AND i.origen_id = o.id
      AND i.activo = TRUE
      AND i.direccion IN (
        'entrada',
        'bidireccional'
      )
    WHERE
      o.id = $1
      AND o.empresa_id = $2
      AND o.activo = TRUE
    ORDER BY
      CASE
        WHEN i.adaptador = 'banco_azteca_api'
          THEN 0
        ELSE 1
      END,
      i.id
    LIMIT 1
    `,
    [
      normalizedOriginId,
      empresaId
    ]
  )

  if (!result.rows[0]) {
    throw new CarteraUploadError(
      'CARTERA_IMPORT_TARGET_NOT_FOUND',
      'El origen no tiene una integración de entrada activa',
      409
    )
  }

  return {
    empresaId,
    originId: result.rows[0].origen_id,
    originCode: result.rows[0].origen_codigo,
    originName: result.rows[0].origen_nombre,
    integrationId: result.rows[0].integracion_id,
    integrationName: result.rows[0].integracion_nombre
  }
}

function summarizePortfolio(
  portfolio,
  target,
  fileSize
) {
  const campaigns = new Set()
  let accountsWithPhone = 0
  let totalBalance = 0

  for (const record of portfolio.records) {
    campaigns.add(record.identity.idCampania)

    if (
      record.snapshot.telefono1
      || record.snapshot.telefono2
      || record.snapshot.telefono3
      || record.snapshot.telefono4
    ) {
      accountsWithPhone++
    }

    totalBalance += Number(record.snapshot.saldo || 0)
  }

  return {
    fileName: portfolio.fileName,
    fileSize,
    sha256: portfolio.sha256,
    date: portfolio.date,
    format: portfolio.format,
    fields: portfolio.headers.length,
    totalRows: portfolio.totalRows,
    campaigns: campaigns.size,
    accountsWithPhone,
    totalBalance: Number(totalBalance.toFixed(2)),
    origin: {
      id: String(target.originId),
      code: target.originCode,
      name: target.originName
    },
    integration: {
      id: String(target.integrationId),
      name: target.integrationName
    }
  }
}

async function previewPortfolioUpload({
  pool,
  usuario,
  originId,
  buffer,
  fileName,
  date
}) {
  const portfolio = readPortfolioBuffer(
    buffer,
    {
      fileName,
      date
    }
  )
  const target = await resolveImportTarget({
    pool,
    usuario,
    originId
  })

  return summarizePortfolio(
    portfolio,
    target,
    buffer.length
  )
}

function purgeExpiredJobs(now = Date.now()) {
  for (const [jobId, job] of importJobs) {
    const terminal = [
      'completed',
      'failed'
    ].includes(job.status)

    if (
      terminal
      && now - job.updatedAt > JOB_TTL_MS
    ) {
      importJobs.delete(jobId)
    }
  }
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
    preview: job.preview,
    result: job.result,
    error: job.error
  }
}

function backgroundError(error) {
  const controlled = (
    error instanceof CarteraImportError
    || error instanceof CarteraPersistenceError
    || error instanceof CarteraUploadError
  )

  return {
    code: controlled
      ? error.code
      : 'CARTERA_IMPORT_INTERNAL_ERROR',
    message: controlled
      ? error.message
      : 'La importación no pudo completarse'
  }
}

async function startPortfolioImport({
  pool,
  usuario,
  originId,
  buffer,
  fileName,
  date,
  previewSha256,
  persistFn = persistPortfolio
}) {
  purgeExpiredJobs()

  const expectedSha256 = String(
    previewSha256 || ''
  ).trim().toLowerCase()

  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new CarteraUploadError(
      'CARTERA_IMPORT_PREVIEW_REQUIRED',
      'Valide el archivo antes de confirmar la importación'
    )
  }

  const portfolio = readPortfolioBuffer(
    buffer,
    {
      fileName,
      date
    }
  )

  if (portfolio.sha256 !== expectedSha256) {
    throw new CarteraUploadError(
      'CARTERA_IMPORT_FILE_CHANGED',
      'El archivo cambió después de la vista previa; vuelva a validarlo',
      409
    )
  }

  const target = await resolveImportTarget({
    pool,
    usuario,
    originId
  })
  const jobId = crypto.randomUUID()
  const now = Date.now()
  const job = {
    id: jobId,
    empresaId: target.empresaId,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    preview: summarizePortfolio(
      portfolio,
      target,
      buffer.length
    ),
    result: null,
    error: null
  }

  importJobs.set(jobId, job)

  setImmediate(async () => {
    job.status = 'processing'
    job.updatedAt = Date.now()

    try {
      job.result = await persistFn({
        pool,
        empresaId: target.empresaId,
        origenId: target.originId,
        integracionId: target.integrationId,
        portfolio,
        creadoPor: resolveUserId(usuario)
      })
      job.status = 'completed'
    } catch (error) {
      job.status = 'failed'
      job.error = backgroundError(error)

      console.error('CARTERA_IMPORT_JOB_ERROR', {
        jobId,
        code: job.error.code
      })
    } finally {
      job.updatedAt = Date.now()
    }
  })

  return publicJob(job)
}

function getPortfolioImportJob({
  usuario,
  jobId
}) {
  purgeExpiredJobs()

  const normalizedJobId = String(jobId || '').trim()
  const job = importJobs.get(normalizedJobId)
  const empresaId = resolveCompanyId(usuario)

  if (!job || job.empresaId !== empresaId) {
    throw new CarteraUploadError(
      'CARTERA_IMPORT_JOB_NOT_FOUND',
      'No se encontró el proceso de importación',
      404
    )
  }

  return publicJob(job)
}

module.exports = {
  CarteraUploadError,
  getPortfolioImportJob,
  previewPortfolioUpload,
  resolveImportTarget,
  startPortfolioImport
}
