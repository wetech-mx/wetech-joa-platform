const express = require('express')

const {
  obtenerCartera,
  obtenerCuentaCartera
} = require('../controllers/cartera.controller')

const {
  verificaToken,
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
  '/cartera/:id',
  obtenerCuentaCartera
)

module.exports = router
