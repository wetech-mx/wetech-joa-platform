const express = require('express')

const {
  actualizarEstadoCartera,
  agregarNotaCartera,
  obtenerCartera,
  obtenerCuentaCartera,
  obtenerEjecutivosCartera,
  obtenerResumenCartera,
  reasignarCuentaCartera
} = require('../controllers/cartera.controller')

const {
  verificaToken,
  requiereAdmin,
  requiereEmpresa
} = require('../middleware/auth')

const router = express.Router()

router.use(
  verificaToken,
  requiereEmpresa
)

router.get(
  '/cartera',
  obtenerCartera
)

router.get(
  '/cartera/ejecutivos',
  obtenerEjecutivosCartera
)

router.get(
  '/cartera/resumen',
  obtenerResumenCartera
)

router.post(
  '/cartera/:id/notas',
  agregarNotaCartera
)

router.patch(
  '/cartera/:id/estado',
  actualizarEstadoCartera
)

router.post(
  '/cartera/:id/reasignar',
  requiereAdmin,
  reasignarCuentaCartera
)

router.get(
  '/cartera/:id',
  obtenerCuentaCartera
)

module.exports = router
