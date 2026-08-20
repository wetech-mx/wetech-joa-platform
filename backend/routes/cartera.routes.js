const express = require('express')

const {
  actualizarEstadoCartera,
  actualizarTipificacionCartera,
  agregarNotaCartera,
  crearTipificacionCartera,
  obtenerCartera,
  obtenerCuentaCartera,
  obtenerEjecutivosCartera,
  obtenerGestionesCartera,
  obtenerOrigenesCartera,
  obtenerResumenCartera,
  obtenerTipificacionesCartera,
  obtenerTipificacionesAdministracion,
  reasignarCuentaCartera,
  registrarGestionCartera
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
  '/cartera/origenes',
  obtenerOrigenesCartera
)

router.get(
  '/cartera/resumen',
  obtenerResumenCartera
)

router.get(
  '/cartera/gestiones',
  obtenerGestionesCartera
)

router.get(
  '/cartera/tipificaciones',
  obtenerTipificacionesCartera
)

router.get(
  '/cartera/tipificaciones/administracion',
  requiereAdmin,
  obtenerTipificacionesAdministracion
)

router.post(
  '/cartera/tipificaciones',
  requiereAdmin,
  crearTipificacionCartera
)

router.patch(
  '/cartera/tipificaciones/:id',
  requiereAdmin,
  actualizarTipificacionCartera
)

router.post(
  '/cartera/:id/gestiones',
  registrarGestionCartera
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
