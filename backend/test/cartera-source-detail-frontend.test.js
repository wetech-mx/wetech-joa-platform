'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  SCL_HEADERS
} = require('../importers/cartera-excel')

const drawerPath = path.join(
  __dirname,
  '../../frontend/src/CarteraDrawer.jsx'
)

test('el expediente organiza los 94 campos de la descarga SCL', () => {
  const source = fs.readFileSync(drawerPath, 'utf8')

  assert.match(source, /Expediente completo de origen/)
  assert.match(source, /account\.datos_origen/)
  assert.match(source, /SOURCE_DETAIL_SECTIONS/)

  for (const header of SCL_HEADERS) {
    assert.match(
      source,
      new RegExp(`['"]${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`),
      `El campo ${header} debe aparecer en el expediente`
    )
  }
})
