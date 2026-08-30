const express = require('express')

const router = express.Router()

const {
  obtenerUsuarios,
  crearUsuario,
  editarUsuario,
  eliminarUsuario,
  restablecerPassword
} = require('../controllers/usuarios.controller')

const {
  verificaToken,
  requiereAdmin,
  requiereEmpresa
} = require('../middleware/auth')

router.get(
  '/usuarios',
  verificaToken,
  requiereEmpresa,
  requiereAdmin,
  obtenerUsuarios
)

router.post(
  '/usuarios',
  verificaToken,
  requiereEmpresa,
  requiereAdmin,
  crearUsuario
)

router.put(
  '/usuarios/:id',
  verificaToken,
  requiereEmpresa,
  requiereAdmin,
  editarUsuario
)

router.patch(
  '/usuarios/:id/password',
  verificaToken,
  requiereEmpresa,
  requiereAdmin,
  restablecerPassword
)

router.delete(
  '/usuarios/:id',
  verificaToken,
  requiereEmpresa,
  requiereAdmin,
  eliminarUsuario
)

module.exports = router
