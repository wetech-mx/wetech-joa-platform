const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appSource = fs.readFileSync(
  path.join(__dirname, '../../frontend/src/App.jsx'),
  'utf8'
)

const integrationSource = fs.readFileSync(
  path.join(
    __dirname,
    '../../frontend/src/Integraciones.jsx'
  ),
  'utf8'
)

test('muestra Integraciones únicamente fuera del rol Ejecutivo', () => {
  assert.match(
    appSource,
    /usuario\?\.rol !== 'Ejecutivo'[\s\S]*setPantalla\('integraciones'\)/
  )
  assert.match(
    appSource,
    /pantalla === 'integraciones'[\s\S]*usuario\?\.rol !== 'Ejecutivo'/
  )
})

test('consulta los tres catálogos con el cliente autenticado', () => {
  assert.match(
    integrationSource,
    /apiFetch\('\/crm-api\/integraciones\/tipos'\)/
  )
  assert.match(
    integrationSource,
    /apiFetch\('\/crm-api\/integraciones\/origenes'\)/
  )
  assert.match(
    integrationSource,
    /apiFetch\('\/crm-api\/integraciones'\)/
  )
})

test('permite alta y edición sin borrar registros', () => {
  assert.match(
    integrationSource,
    /method = editingOriginId \? 'PATCH' : 'POST'/
  )
  assert.match(
    integrationSource,
    /method = editingIntegrationId \? 'PATCH' : 'POST'/
  )
  assert.doesNotMatch(
    integrationSource,
    /method:\s*['"]DELETE['"]/
  )
})

test('no envía campos de credenciales al backend', () => {
  assert.doesNotMatch(
    integrationSource,
    /referencia_secreto\s*:/
  )
  assert.doesNotMatch(
    integrationSource,
    /type=["']password["']/
  )
  assert.match(
    integrationSource,
    /secreto_configurado/
  )
})

test('los conectores nuevos quedan inactivos por defecto', () => {
  assert.match(
    integrationSource,
    /const EMPTY_INTEGRATION = \{[\s\S]*activo: false/
  )
})

test('incluye conectores del universo Aspel y bases de datos', () => {
  for (const connector of [
    'firebird',
    'sql_server',
    'odbc',
    'aspel_dac'
  ]) {
    assert.match(integrationSource, new RegExp(connector))
  }
})
