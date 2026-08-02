const pool = require('../config/database')

const {
  CarteraReadError,
  getPortfolioAccount,
  getPortfolioSummary,
  listPortfolioExecutives,
  listPortfolioOrigins,
  listPortfolio
} = require('../repositories/cartera-read-repository')

const {
  CarteraManagementError,
  addPortfolioNote,
  reassignPortfolioAccount,
  updatePortfolioState
} = require(
  '../repositories/cartera-management-repository'
)

function respondWithError(
  res,
  error
) {
  if (
    error instanceof CarteraReadError
    || error instanceof CarteraManagementError
  ) {
    return res
      .status(error.status)
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
  agregarNotaCartera,
  obtenerCartera,
  obtenerCuentaCartera,
  obtenerEjecutivosCartera,
  obtenerOrigenesCartera,
  obtenerResumenCartera,
  reasignarCuentaCartera,
  respondWithError
}
