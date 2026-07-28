const express = require('express')

const router = express.Router()

const {
  obtenerUsuarios,
  crearUsuario,
  editarUsuario,
  eliminarUsuario
} = require('../controllers/usuarios.controller')

const {
  verificaToken,
  requiereAdmin
} = require('../middleware/auth')

router.get(
  '/usuarios',
  verificaToken,
  requiereAdmin,
  obtenerUsuarios
)

router.post(
  '/usuarios',
  verificaToken,
  requiereAdmin,
  crearUsuario
)

router.put(
  '/usuarios/:id',
  verificaToken,
  requiereAdmin,
  editarUsuario
)

router.delete(
  '/usuarios/:id',
  verificaToken,
  requiereAdmin,
  eliminarUsuario
)

module.exports = router
