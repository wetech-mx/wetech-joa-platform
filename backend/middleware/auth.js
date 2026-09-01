const jwt = require('jsonwebtoken')

const { JWT_SECRET } = require('../config/auth')
const pool = require('../config/database')
const { ROLES } = require('../config/constants')
const {
  SessionControlError,
  validateSession
} = require('../repositories/session-control-repository')

async function verificaToken(req, res, next) {

  const authHeader = req.headers.authorization

  const match = typeof authHeader === 'string'
    ? authHeader.match(/^Bearer\s+([^\s]+)$/i)
    : null

  if (!match) {
    return res.status(401).json({
      error: 'Token requerido'
    })
  }

  const token = match[1]

  try {

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    )

    await validateSession({
      pool,
      usuario: decoded,
      sessionId: decoded.jti
    })

    req.usuario = {
      ...decoded,
      session_id: decoded.jti
    }

    return next()

  } catch (error) {

    if (
      error instanceof SessionControlError
      || error?.name === 'JsonWebTokenError'
      || error?.name === 'TokenExpiredError'
    ) {
      return res.status(401).json({
        error: error instanceof SessionControlError
          ? error.message
          : 'Token inválido',
        code: error instanceof SessionControlError
          ? error.code
          : 'TOKEN_INVALID'
      })
    }

    console.error('SESSION_VALIDATION_ERROR', {
      name: error?.name || 'Error',
      code: error?.code || 'UNEXPECTED'
    })

    return res.status(503).json({
      error: 'No fue posible validar la sesión',
      code: 'SESSION_VALIDATION_UNAVAILABLE'
    })

  }

}

function requiereEmpresa(req, res, next) {

  const companyId = Number(req.usuario?.empresa_id)

  if (
    !Number.isSafeInteger(companyId)
    || companyId <= 0
  ) {
    return res.status(403).json({
      error: 'Empresa no válida'
    })
  }

  req.usuario.empresa_id = companyId

  next()

}

function requiereAdmin(req, res, next) {

  if (
    req.usuario.rol !== ROLES.ADMIN &&
    req.usuario.rol !== ROLES.SUPER_ADMIN
  ) {
    return res.status(403).json({
      error: 'Permisos insuficientes'
    })
  }

  next()

}

function requiereSuperAdmin(req, res, next) {

  if (req.usuario.rol !== ROLES.SUPER_ADMIN) {
    return res.status(403).json({
      error: 'Solo Super Admin'
    })
  }

  next()

}

module.exports = {
  verificaToken,
  requiereEmpresa,
  requiereAdmin,
  requiereSuperAdmin
}
