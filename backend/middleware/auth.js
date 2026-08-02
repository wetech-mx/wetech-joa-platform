const jwt = require('jsonwebtoken')

const { JWT_SECRET } = require('../config/auth')
const { ROLES } = require('../config/constants')

function verificaToken(req, res, next) {

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

    req.usuario = decoded

    next()

  } catch (error) {

    return res.status(401).json({
      error: 'Token inválido'
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
