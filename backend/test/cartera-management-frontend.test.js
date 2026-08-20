const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function source(relativePath) {
  return fs.readFileSync(
    path.join(__dirname, '../../frontend/src', relativePath),
    'utf8'
  )
}

test('el expediente consulta tipificaciones dinámicas', () => {
  const drawer = source('CarteraDrawer.jsx')

  assert.match(drawer, /\/crm-api\/cartera\/tipificaciones/)
  assert.match(drawer, /selectedTypification/)
  assert.match(drawer, /requiere_promesa/)
  assert.match(drawer, /requiere_seguimiento/)
})

test('el formulario envía una gestión estructurada', () => {
  const drawer = source('CarteraDrawer.jsx')

  assert.match(
    drawer,
    /\/crm-api\/cartera\/\$\{accountId\}\/gestiones/
  )
  assert.match(drawer, /tipificacion_id/)
  assert.match(drawer, /telefono_contactado/)
  assert.match(drawer, /persona_contactada/)
  assert.match(drawer, /relacion_contacto/)
  assert.match(drawer, /promesa_monto/)
  assert.match(drawer, /proximo_seguimiento_at/)
  assert.match(drawer, /evidencia/)
})

test('la pantalla ya no permite cambiar estado manualmente', () => {
  const drawer = source('CarteraDrawer.jsx')

  assert.doesNotMatch(drawer, /Guardar estado/)
  assert.doesNotMatch(drawer, /Agregar nota/)
  assert.match(drawer, /Registrar gestión/)
})

test('supervisión consulta y filtra gestiones estructuradas', () => {
  const managements = source('CarteraGestiones.jsx')
  const app = source('App.jsx')

  assert.match(
    managements,
    /\/crm-api\/cartera\/gestiones\?\$\{query\}/
  )
  assert.match(managements, /name="resultado"/)
  assert.match(managements, /name="ejecutivo"/)
  assert.match(managements, /name="origen"/)
  assert.match(managements, /name="desde"/)
  assert.match(managements, /name="hasta"/)
  assert.match(managements, /Abrir cuenta/)
  assert.match(
    managements,
    /Todavía no hay gestiones registradas/
  )
  assert.match(app, /import CarteraGestiones/)
  assert.match(app, /setPantalla\('gestiones'\)/)
  assert.match(app, /usuario\?\.rol !== 'Ejecutivo'/)
})

test('administración edita el catálogo sin eliminar historial', () => {
  const catalog = source('CarteraTipificaciones.jsx')
  const app = source('App.jsx')

  assert.match(
    catalog,
    /\/crm-api\/cartera\/tipificaciones\/administracion/
  )
  assert.match(catalog, /method: editing \? 'PATCH' : 'POST'/)
  assert.match(catalog, /Desactivar conserva el historial/)
  assert.match(catalog, /requiere_promesa/)
  assert.match(catalog, /requiere_seguimiento/)
  assert.match(catalog, /cierra_cuenta/)
  assert.doesNotMatch(catalog, /method: 'DELETE'/)
  assert.match(app, /import CarteraTipificaciones/)
  assert.match(app, /setPantalla\('tipificaciones'\)/)
})
