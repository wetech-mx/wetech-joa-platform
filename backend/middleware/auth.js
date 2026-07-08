const jwt = require('jsonwebtoken')

const { JWT_SECRET } = require('../config/auth')
const { ROLES } = require('../config/constants')

function verificaToken(req, res, next) {

  const authHeader = req.headers.authorization

  if (!authHeader) {
    return res.status(401).json({
      error: 'Token requerido'
    })
  }

  const token = authHeader.split(' ')[1]

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

  if (!req.usuario.empresa_id) {
    return res.status(403).json({
      error: 'Empresa no válida'
    })
  }

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
