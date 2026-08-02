'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const backend = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(
    path.join(backend, relativePath),
    'utf8'
  )
}

test('server no conserva rutas legacy en línea', () => {
  const server = read('server.js')

  assert.doesNotMatch(server, /app\.(get|post|put|delete)\('\/api\//)
  assert.match(server, /app\.use\('\/api', leadsRoutes\)/)
})

test('todas las rutas de leads requieren token y empresa', () => {
  const routes = read('routes/leads.routes.js')

  assert.match(
    routes,
    /router\.use\(verificaToken, requiereEmpresa\)/
  )
  assert.match(
    routes,
    /'\/leads\/:id\/asignar', requiereAdmin, asignar/
  )
  assert.match(
    routes,
    /'\/importar-leads',[\s\S]*requiereAdmin/
  )
})

test('cada ruta de usuarios exige token empresa y administración', () => {
  const routes = read('routes/usuarios.routes.js')

  assert.doesNotMatch(routes, /router\.use\(/)

  const protectedRoutes = routes.match(
    /router\.(get|post|put|delete)\([\s\S]*?requiereAdmin,/g
  ) || []

  assert.equal(protectedRoutes.length, 4)

  for (const route of protectedRoutes) {
    assert.match(route, /verificaToken,/)
    assert.match(route, /requiereEmpresa,/)
  }
})

test('frontend usa el cliente autenticado en rutas protegidas', () => {
  const app = read('../frontend/src/App.jsx')
  const drawer = read('../frontend/src/LeadDrawer.jsx')
  const bank = read('../frontend/src/BancoAzteca.jsx')

  assert.doesNotMatch(app, /await fetch\(`\/crm-api\/leads/)
  assert.match(app, /apiFetch\(`\/crm-api\/leads/)
  assert.doesNotMatch(drawer, /\n\s*fetch\(/)
  assert.match(drawer, /apiFetch\(/)
  assert.doesNotMatch(bank, /localStorage\.getItem\('token'\)/)
})
