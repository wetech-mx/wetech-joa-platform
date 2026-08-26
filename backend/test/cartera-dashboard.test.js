'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(
    path.join(root, relativePath),
    'utf8'
  )
}

test('expone el resumen dentro de rutas protegidas de cartera', () => {
  const routes = read('backend/routes/cartera.routes.js')

  assert.match(
    routes,
    /router\.use\(\s*verificaToken,\s*requiereEmpresa\s*\)/
  )
  assert.match(
    routes,
    /'\/cartera\/resumen',\s*obtenerResumenCartera/
  )
  assert.match(
    routes,
    /'\/cartera\/origenes',\s*obtenerOrigenesCartera/
  )
})

test('el Dashboard consulta el resumen con el cliente autenticado', () => {
  const dashboard = read(
    'frontend/src/CarteraDashboard.jsx'
  )

  assert.match(
    dashboard,
    /apiFetch\(endpoint,/
  )
  assert.match(
    dashboard,
    /apiFetch\('\/crm-api\/cartera\/origenes'/
  )
  assert.doesNotMatch(
    dashboard,
    /localStorage\.getItem\('token'\)/
  )
})

test('Cartera permite filtrar y mostrar el origen', () => {
  const cartera = read('frontend/src/Cartera.jsx')

  assert.match(
    cartera,
    /name="origen"/
  )
  assert.match(
    cartera,
    /row\.origen_nombre/
  )
  assert.doesNotMatch(
    cartera,
    /Cartera Banco Azteca/
  )
})

test('la pantalla Dashboard incorpora las métricas de cartera', () => {
  const app = read('frontend/src/App.jsx')

  assert.match(
    app,
    /import CarteraDashboard from '\.\/CarteraDashboard'/
  )
  assert.match(
    app,
    /<CarteraDashboard[\s\S]*onOpenAccount=\{openPortfolioAccount\}[\s\S]*\/>/
  )
})
