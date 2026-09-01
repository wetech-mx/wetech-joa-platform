const express = require('express')

const router = express.Router()

const {
  login
} = require('../controllers/auth.controller')

const {
  cerrarSesionAdministrativa,
  cerrarSesionPropia,
  obtenerSesiones,
  registrarActividad
} = require('../controllers/sessions.controller')

const {
  requiereAdmin,
  requiereEmpresa,
  verificaToken
} = require('../middleware/auth')

router.post(
  '/login',
  login
)

router.post(
  '/logout',
  verificaToken,
  requiereEmpresa,
  cerrarSesionPropia
)

router.post(
  '/sesiones/heartbeat',
  verificaToken,
  requiereEmpresa,
  registrarActividad
)

router.get(
  '/sesiones',
  verificaToken,
  requiereEmpresa,
  requiereAdmin,
  obtenerSesiones
)

router.patch(
  '/sesiones/:id/cerrar',
  verificaToken,
  requiereEmpresa,
  requiereAdmin,
  cerrarSesionAdministrativa
)

module.exports = router
