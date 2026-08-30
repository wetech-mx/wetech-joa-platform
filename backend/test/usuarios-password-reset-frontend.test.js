'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const users = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../frontend/src/Usuarios.jsx'
  ),
  'utf8'
)

const controller = fs.readFileSync(
  path.resolve(
    __dirname,
    '../controllers/usuarios.controller.js'
  ),
  'utf8'
)

const routes = fs.readFileSync(
  path.resolve(
    __dirname,
    '../routes/usuarios.routes.js'
  ),
  'utf8'
)

test('administración ofrece restablecimiento seguro de contraseña', () => {
  assert.match(users, /Restablecer contraseña/)
  assert.match(users, /\/crm-api\/usuarios\/\$\{usuarioPassword\.id\}\/password/)
  assert.match(users, /method: 'PATCH'/)
  assert.match(users, /passwordNueva !== passwordConfirmacion/)
  assert.match(users, /minLength="10"/)
  assert.match(users, /autoComplete="new-password"/)
  assert.match(users, /usuario\.rol === 'super_admin'/)
  assert.doesNotMatch(users, /password_hash/)
})

test('la API cifra y protege el restablecimiento de contraseña', () => {
  assert.match(controller, /bcrypt\.hash\(password, 12\)/)
  assert.match(controller, /resetUserPassword/)
  assert.match(routes, /'\/usuarios\/:id\/password'/)
  assert.match(
    routes,
    /'\/usuarios\/:id\/password',[\s\S]*verificaToken,[\s\S]*requiereEmpresa,[\s\S]*requiereAdmin,[\s\S]*restablecerPassword/
  )
})
