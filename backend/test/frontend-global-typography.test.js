const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const frontendPath = path.resolve(
  __dirname,
  '../../frontend/src'
)

function readSource(fileName) {
  return fs.readFileSync(
    path.join(frontendPath, fileName),
    'utf8'
  )
}

test('usa la tipografía regular en todo el CRM', () => {
  const styles = readSource('index.css')

  assert.match(
    styles,
    /font-family:\s*Arial, Helvetica, sans-serif/
  )
  assert.match(styles, /font-synthesis:\s*none/)
  assert.match(
    styles,
    /body[\s\S]*font-weight:\s*400/
  )
  assert.doesNotMatch(styles, /font-family:\s*Inter/)
})

test('identifica el contenedor principal y el acceso', () => {
  assert.match(readSource('App.jsx'), /crm-app/)
  assert.match(readSource('Login.jsx'), /crm-login/)
})

test('mantiene valores y acciones operativas en peso regular', () => {
  const portfolio = readSource('Cartera.jsx')
  const dashboard = readSource('CarteraDashboard.jsx')
  const bank = readSource('BancoAzteca.jsx')
  const drawer = readSource('CarteraDrawer.jsx')

  assert.match(
    portfolio,
    /text-3xl font-normal text-orange-700/
  )
  assert.match(
    dashboard,
    /break-words text-3xl font-normal/
  )
  assert.match(
    bank,
    /text-white font-normal px-5 py-3/
  )
  assert.match(
    drawer,
    /break-words font-normal/
  )
})

test('conserva títulos y encabezados con énfasis', () => {
  const app = readSource('App.jsx')
  const portfolio = readSource('Cartera.jsx')
  const users = readSource('Usuarios.jsx')

  assert.match(app, /<h1 className="text-5xl font-bold">/)
  assert.match(portfolio, /<h1 className="mt-1 text-4xl font-bold">/)
  assert.match(users, /<thead>/)
})
