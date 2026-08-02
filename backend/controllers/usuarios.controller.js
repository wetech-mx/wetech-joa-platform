'use strict'

const bcrypt = require('bcrypt')

const pool = require('../config/database')
const {
  UserSecurityError,
  createUser,
  deactivateUser,
  listUsers,
  normalizeUserInput,
  updateUser
} = require('../repositories/usuarios-repository')

function sendUserError(res, error) {
  if (error instanceof UserSecurityError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code
    })
  }

  console.error('USUARIOS_API_ERROR:', error)

  return res.status(500).json({
    error: 'Error interno procesando usuarios'
  })
}

async function obtenerUsuarios(req, res) {
  try {
    res.json(await listUsers({
      pool,
      usuario: req.usuario
    }))
  } catch (error) {
    sendUserError(res, error)
  }
}

async function crearUsuario(req, res) {
  try {
    const input = normalizeUserInput(
      req.body,
      {
        requirePassword: true
      }
    )
    const passwordHash = await bcrypt.hash(
      input.password,
      12
    )
    const created = await createUser({
      pool,
      usuario: req.usuario,
      input,
      passwordHash
    })

    res.status(201).json(created)
  } catch (error) {
    sendUserError(res, error)
  }
}

async function editarUsuario(req, res) {
  try {
    const input = normalizeUserInput(req.body)
    res.json(await updateUser({
      pool,
      usuario: req.usuario,
      userId: req.params.id,
      input
    }))
  } catch (error) {
    sendUserError(res, error)
  }
}

async function eliminarUsuario(req, res) {
  try {
    res.json(await deactivateUser({
      pool,
      usuario: req.usuario,
      userId: req.params.id
    }))
  } catch (error) {
    sendUserError(res, error)
  }
}

module.exports = {
  crearUsuario,
  editarUsuario,
  eliminarUsuario,
  obtenerUsuarios,
  sendUserError
}
