const express = require('express')

const {
  crearIntegracion,
  crearOrigen,
  editarIntegracion,
  editarOrigen,
  obtenerEjecuciones,
  obtenerIntegraciones,
  obtenerOrigenes,
  obtenerTiposIntegracion
} = require('../controllers/integrations.controller')

const {
  verificaToken,
  requiereAdmin,
  requiereEmpresa
} = require('../middleware/auth')

const router = express.Router()

router.use(
  verificaToken,
  requiereEmpresa,
  requiereAdmin
)

router.get(
  '/integraciones/tipos',
  obtenerTiposIntegracion
)

router.get(
  '/integraciones/origenes',
  obtenerOrigenes
)

router.post(
  '/integraciones/origenes',
  crearOrigen
)

router.patch(
  '/integraciones/origenes/:id',
  editarOrigen
)

router.get(
  '/integraciones',
  obtenerIntegraciones
)

router.get(
  '/integraciones/ejecuciones',
  obtenerEjecuciones
)

router.post(
  '/integraciones/origenes/:id/integraciones',
  crearIntegracion
)

router.patch(
  '/integraciones/:id',
  editarIntegracion
)

module.exports = router
