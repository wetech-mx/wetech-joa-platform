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

const indexStyles = fs.readFileSync(
  path.join(__dirname, '../../frontend/src/index.css'),
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
  assert.match(
    integrationSource,
    /apiFetch\('\/crm-api\/integraciones\/ejecuciones\?limite=100'\)/
  )
})

test('muestra historial operativo sin campos secretos', () => {
  assert.match(
    integrationSource,
    /Historial de ejecuciones/
  )
  assert.match(
    integrationSource,
    /ExecutionBadge/
  )
  assert.match(
    integrationSource,
    /error_codigo/
  )
  assert.doesNotMatch(
    integrationSource,
    /error_detalle|referencia_secreto/
  )
})

test('aplica una distribución compacta al panel administrativo', () => {
  assert.match(appSource, /w-56 min-h-screen/)
  assert.match(appSource, /p-6 lg:p-8/)
  assert.match(integrationSource, /text-\[14px\]/)
})

test('reserva la negrita para títulos y encabezados', () => {
  assert.match(integrationSource, /integrations-page/)
  assert.match(appSource, /crm-navigation/)
  assert.match(
    indexStyles,
    /\.integrations-page \*[\s\S]*font-weight:\s*400\s*!important/
  )
  assert.match(
    indexStyles,
    /\.integrations-page thead th[\s\S]*font-weight:\s*700\s*!important/
  )
  assert.match(
    indexStyles,
    /:root[\s\S]*font-family:\s*Arial, Helvetica, sans-serif/
  )
  assert.match(indexStyles, /font-synthesis:\s*none/)
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
