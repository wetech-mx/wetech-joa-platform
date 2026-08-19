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
