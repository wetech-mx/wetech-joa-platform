const pool = require('../config/database')

const {
  CarteraReadError,
  getPortfolioAccount,
  listPortfolio
} = require('../repositories/cartera-read-repository')

function respondWithError(
  res,
  error
) {
  if (error instanceof CarteraReadError) {
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

module.exports = {
  obtenerCartera,
  obtenerCuentaCartera,
  respondWithError
}
