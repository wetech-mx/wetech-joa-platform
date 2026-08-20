const pool = require('../config/database')

const {
  CarteraImportError
} = require('../importers/cartera-excel')
const {
  CarteraPersistenceError
} = require('../importers/cartera-repository')

const {
  CarteraReadError,
  getPortfolioAccount,
  getPortfolioSummary,
  listPortfolioExecutives,
  listPortfolioManagements,
  listPortfolioOrigins,
  listPortfolio
} = require('../repositories/cartera-read-repository')

const {
  CarteraManagementError,
  addPortfolioNote,
  createPortfolioTypification,
  listPortfolioTypifications,
  listPortfolioTypificationsAdmin,
  reassignPortfolioAccount,
  registerPortfolioManagement,
  updatePortfolioTypification,
  updatePortfolioState
} = require(
  '../repositories/cartera-management-repository'
)

const {
  CarteraUploadError,
  getPortfolioImportJob,
  previewPortfolioUpload,
  startPortfolioImport
} = require('../services/cartera-upload-service')

function respondWithError(
  res,
  error
) {
  if (
    error instanceof CarteraReadError
    || error instanceof CarteraManagementError
    || error instanceof CarteraUploadError
  ) {
    return res
      .status(error.status)
      .json({
        error: error.message,
        code: error.code
      })
  }

  if (
    error instanceof CarteraImportError
    || error instanceof CarteraPersistenceError
  ) {
    return res
      .status(
        error instanceof CarteraPersistenceError
          ? 409
          : 400
      )
      .json({
        error: error.message,
        code: error.code
      })
  }

  console.error(
    'CARTERA_API_ERROR',
    {
      name: error?.name || 'Error',
      code: error?.code || 'UNEXPECTED'
    }
  )

  return res.status(500).json({
    error: 'Error consultando cartera',
    code: 'CARTERA_API_INTERNAL_ERROR'
  })
}

async function obtenerCartera(
  req,
  res
) {
  try {
    const result = await listPortfolio({
      pool,
      usuario: req.usuario,
      query: req.query
    })

    return res.json(result)
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function previsualizarImportacionCartera(
  req,
  res
) {
  try {
    const result = await previewPortfolioUpload({
      pool,
      usuario: req.usuario,
      originId: req.body?.origen_id,
      buffer: req.file?.buffer,
      fileName: req.file?.originalname,
      date: req.body?.fecha
    })

    return res.json({
      preview: result
    })
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function confirmarImportacionCartera(
  req,
  res
) {
  try {
    const job = await startPortfolioImport({
      pool,
      usuario: req.usuario,
      originId: req.body?.origen_id,
      buffer: req.file?.buffer,
      fileName: req.file?.originalname,
      date: req.body?.fecha,
      previewSha256: req.body?.confirmacion_sha256
    })

    return res.status(202).json({ job })
  } catch (error) {
    return respondWithError(res, error)
  }
}

function obtenerEstadoImportacionCartera(
  req,
  res
) {
  try {
    const job = getPortfolioImportJob({
      usuario: req.usuario,
      jobId: req.params.jobId
    })

    return res.json({ job })
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function obtenerCuentaCartera(
  req,
  res
) {
  try {
    const result = await getPortfolioAccount({
      pool,
      usuario: req.usuario,
      accountId: req.params.id
    })

    return res.json(result)
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function obtenerResumenCartera(
  req,
  res
) {
  try {
    const result = await getPortfolioSummary({
      pool,
      usuario: req.usuario,
      query: req.query
    })

    return res.json(result)
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function obtenerOrigenesCartera(
  req,
  res
) {
  try {
    const result = await listPortfolioOrigins({
      pool,
      usuario: req.usuario
    })

    return res.json(result)
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function obtenerEjecutivosCartera(
  req,
  res
) {
  try {
    const result = await listPortfolioExecutives({
      pool,
      usuario: req.usuario
    })

    return res.json(result)
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function obtenerGestionesCartera(
  req,
  res
) {
  try {
    const result = await listPortfolioManagements({
      pool,
      usuario: req.usuario,
      query: req.query
    })

    return res.json(result)
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function obtenerTipificacionesCartera(
  req,
  res
) {
  try {
    const result = await listPortfolioTypifications({
      pool,
      usuario: req.usuario
    })

    return res.json(result)
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function obtenerTipificacionesAdministracion(
  req,
  res
) {
  try {
    const result = await listPortfolioTypificationsAdmin({
      pool,
      usuario: req.usuario
    })

    return res.json(result)
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function crearTipificacionCartera(
  req,
  res
) {
  try {
    const result = await createPortfolioTypification({
      pool,
      usuario: req.usuario,
      input: req.body
    })

    return res.status(201).json(result)
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function actualizarTipificacionCartera(
  req,
  res
) {
  try {
    const result = await updatePortfolioTypification({
      pool,
      usuario: req.usuario,
      typificationId: req.params.id,
      input: req.body
    })

    return res.json(result)
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function registrarGestionCartera(
  req,
  res
) {
  try {
    const result = await registerPortfolioManagement({
      pool,
      usuario: req.usuario,
      accountId: req.params.id,
      input: req.body
    })

    return res.status(201).json(result)
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function agregarNotaCartera(
  req,
  res
) {
  try {
    const result = await addPortfolioNote({
      pool,
      usuario: req.usuario,
      accountId: req.params.id,
      note: req.body?.nota
    })

    return res.status(201).json(result)
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function actualizarEstadoCartera(
  req,
  res
) {
  try {
    const result = await updatePortfolioState({
      pool,
      usuario: req.usuario,
      accountId: req.params.id,
      state: req.body?.estado,
      detail: req.body?.detalle
    })

    return res.json(result)
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function reasignarCuentaCartera(
  req,
  res
) {
  try {
    const result = await reassignPortfolioAccount({
      pool,
      usuario: req.usuario,
      accountId: req.params.id,
      executiveId: req.body?.ejecutivo_id,
      reason: req.body?.motivo
    })

    return res.status(201).json(result)
  } catch (error) {
    return respondWithError(res, error)
  }
}

module.exports = {
  actualizarEstadoCartera,
  actualizarTipificacionCartera,
  agregarNotaCartera,
  confirmarImportacionCartera,
  crearTipificacionCartera,
  obtenerCartera,
  obtenerCuentaCartera,
  obtenerEjecutivosCartera,
  obtenerEstadoImportacionCartera,
  obtenerGestionesCartera,
  obtenerOrigenesCartera,
  obtenerResumenCartera,
  obtenerTipificacionesCartera,
  obtenerTipificacionesAdministracion,
  previsualizarImportacionCartera,
  reasignarCuentaCartera,
  registrarGestionCartera,
  respondWithError
}
