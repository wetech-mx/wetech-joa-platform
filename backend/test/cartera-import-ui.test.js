const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function source(relativePath) {
  return fs.readFileSync(
    path.join(__dirname, '..', '..', relativePath),
    'utf8'
  )
}

test('las rutas de importación exigen administración', () => {
  const routes = source('backend/routes/cartera.routes.js')

  assert.match(
    routes,
    /'\/cartera\/importaciones\/preview',[\s\S]*requiereAdmin[\s\S]*receivePortfolioFile/
  )
  assert.match(
    routes,
    /'\/cartera\/importaciones\/confirm',[\s\S]*requiereAdmin[\s\S]*receivePortfolioFile/
  )
  assert.match(routes, /fileSize: 25 \* 1024 \* 1024/)
})

test('Cartera muestra carga solo a roles administrativos', () => {
  const cartera = source('frontend/src/Cartera.jsx')

  assert.match(cartera, /'Administrador'/)
  assert.match(cartera, /'super_admin'/)
  assert.match(cartera, /Importar descarga SCL/)
  assert.match(cartera, /<CarteraImportDialog/)
})

test('la interfaz separa vista previa y confirmación', () => {
  const dialog = source(
    'frontend/src/CarteraImportDialog.jsx'
  )

  assert.match(dialog, /\/importaciones\/preview/)
  assert.match(dialog, /\/importaciones\/confirm/)
  assert.match(dialog, /confirmacion_sha256/)
  assert.match(dialog, /Confirmar e importar cartera/)
  assert.match(dialog, /importaciones\/trabajos/)
})
