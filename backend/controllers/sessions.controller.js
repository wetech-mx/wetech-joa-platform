'use strict'

const pool = require('../config/database')
const {
  SessionControlError,
  closeOwnSession,
  closeSession,
  listSessions
} = require('../repositories/session-control-repository')

function sendSessionError(res, error) {
  if (error instanceof SessionControlError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code
    })
  }

  console.error('SESIONES_API_ERROR', {
    name: error?.name || 'Error',
    code: error?.code || 'UNEXPECTED'
  })

  return res.status(500).json({
    error: 'Error interno administrando sesiones',
    code: 'SESSION_INTERNAL_ERROR'
  })
}

async function obtenerSesiones(req, res) {
  try {
    return res.json(await listSessions({
      pool,
      usuario: req.usuario
    }))
  } catch (error) {
    return sendSessionError(res, error)
  }
}

async function cerrarSesionAdministrativa(req, res) {
  try {
    return res.json(await closeSession({
      pool,
      usuario: req.usuario,
      sessionId: req.params.id,
      reason: req.body?.motivo
    }))
  } catch (error) {
    return sendSessionError(res, error)
  }
}

async function cerrarSesionPropia(req, res) {
  try {
    return res.json(await closeOwnSession({
      pool,
      usuario: req.usuario
    }))
  } catch (error) {
    return sendSessionError(res, error)
  }
}

function registrarActividad(req, res) {
  return res.json({
    success: true,
    serverTime: new Date().toISOString()
  })
}

module.exports = {
  cerrarSesionAdministrativa,
  cerrarSesionPropia,
  obtenerSesiones,
  registrarActividad,
  sendSessionError
}
