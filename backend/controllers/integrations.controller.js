const pool = require('../config/database')

const {
  IntegrationAdminError,
  createIntegration,
  createOrigin,
  listIntegrationTypes,
  listIntegrations,
  listOrigins,
  updateIntegration,
  updateOrigin
} = require(
  '../repositories/integrations-management-repository'
)

const {
  IntegrationExecutionError,
  listCompanyIntegrationExecutions
} = require(
  '../repositories/integration-execution-repository'
)

function respondWithError(res, error) {
  if (error instanceof IntegrationAdminError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code
    })
  }

  if (error instanceof IntegrationExecutionError) {
    return res.status(400).json({
      error: error.message,
      code: error.code
    })
  }

  console.error('INTEGRATIONS_API_ERROR', {
    name: error?.name || 'Error',
    code: error?.code || 'UNEXPECTED'
  })

  return res.status(500).json({
    error: 'Error administrando integraciones',
    code: 'INTEGRATIONS_API_INTERNAL_ERROR'
  })
}

async function obtenerEjecuciones(req, res) {
  try {
    return res.json(
      await listCompanyIntegrationExecutions({
        pool,
        empresaId: req.usuario.empresa_id,
        origenId: req.query.origen_id,
        integracionId: req.query.integracion_id,
        status: req.query.estado,
        stage: req.query.etapa,
        limit: req.query.limite || 50
      })
    )
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function obtenerTiposIntegracion(req, res) {
  try {
    return res.json(await listIntegrationTypes({
      pool,
      usuario: req.usuario
    }))
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function obtenerOrigenes(req, res) {
  try {
    return res.json(await listOrigins({
      pool,
      usuario: req.usuario
    }))
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function crearOrigen(req, res) {
  try {
    const result = await createOrigin({
      pool,
      usuario: req.usuario,
      body: req.body
    })

    return res.status(201).json(result)
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function editarOrigen(req, res) {
  try {
    return res.json(await updateOrigin({
      pool,
      usuario: req.usuario,
      originId: req.params.id,
      body: req.body
    }))
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function obtenerIntegraciones(req, res) {
  try {
    return res.json(await listIntegrations({
      pool,
      usuario: req.usuario,
      originId: req.query.origen_id
    }))
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function crearIntegracion(req, res) {
  try {
    const result = await createIntegration({
      pool,
      usuario: req.usuario,
      originId: req.params.id,
      body: req.body
    })

    return res.status(201).json(result)
  } catch (error) {
    return respondWithError(res, error)
  }
}

async function editarIntegracion(req, res) {
  try {
    return res.json(await updateIntegration({
      pool,
      usuario: req.usuario,
      integrationId: req.params.id,
      body: req.body
    }))
  } catch (error) {
    return respondWithError(res, error)
  }
}

module.exports = {
  crearIntegracion,
  crearOrigen,
  editarIntegracion,
  editarOrigen,
  obtenerEjecuciones,
  obtenerIntegraciones,
  obtenerOrigenes,
  obtenerTiposIntegracion
}
