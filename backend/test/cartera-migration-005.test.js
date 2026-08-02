const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const migrationPath = path.join(
  __dirname,
  '../migrations/005_link_portfolio_to_origins.sql'
)
const sql = fs.readFileSync(migrationPath, 'utf8')

test('requiere los catálogos de la migración 004', () => {
  assert.match(
    sql,
    /WHERE version = '004_create_integration_catalogs'/
  )
  assert.match(
    sql,
    /La migracion 004_create_integration_catalogs no esta aplicada/
  )
})

test('relaciona cada importación con origen e integración', () => {
  assert.match(
    sql,
    /ALTER TABLE public\.cartera_importaciones[\s\S]*ADD COLUMN origen_id BIGINT,[\s\S]*ADD COLUMN integracion_id BIGINT/
  )
  assert.match(
    sql,
    /FOREIGN KEY \(empresa_id, origen_id\)[\s\S]*REFERENCES public\.crm_origenes\(empresa_id, id\)/
  )
  assert.match(
    sql,
    /FOREIGN KEY \([\s\S]*empresa_id,[\s\S]*origen_id,[\s\S]*integracion_id[\s\S]*\)[\s\S]*REFERENCES public\.crm_integraciones/
  )
})

test('migra los registros anteriores al origen Banco Azteca', () => {
  assert.match(
    sql,
    /origen\.codigo = 'banco_azteca'/
  )
  assert.match(
    sql,
    /integracion\.codigo = 'banco_azteca_api'/
  )
  assert.match(
    sql,
    /No se puede identificar Banco Azteca para una importacion existente/
  )
})

test('aísla importaciones e identidades por origen', () => {
  assert.match(
    sql,
    /cartera_importaciones_sha256_unico[\s\S]*UNIQUE \([\s\S]*empresa_id,[\s\S]*origen_id,[\s\S]*archivo_sha256/
  )
  assert.match(
    sql,
    /ux_cartera_importaciones_completada_fecha[\s\S]*empresa_id,[\s\S]*origen_id,[\s\S]*fecha_cartera/
  )
  assert.match(
    sql,
    /cartera_cuentas_identidad_unica[\s\S]*UNIQUE \([\s\S]*empresa_id,[\s\S]*origen_id,[\s\S]*id_campania,[\s\S]*id_cliente,[\s\S]*folio/
  )
  assert.match(
    sql,
    /cartera_cuentas_ultima_importacion_origen_fkey[\s\S]*FOREIGN KEY \([\s\S]*empresa_id,[\s\S]*origen_id,[\s\S]*ultima_importacion_id[\s\S]*REFERENCES public\.cartera_importaciones/
  )
})

test('separa el cursor round robin por origen y campaña', () => {
  assert.match(
    sql,
    /ALTER TABLE public\.cartera_round_robin_estado[\s\S]*ADD COLUMN origen_id BIGINT/
  )
  assert.match(
    sql,
    /cartera_round_robin_estado_pkey[\s\S]*PRIMARY KEY \([\s\S]*empresa_id,[\s\S]*origen_id,[\s\S]*id_campania/
  )
  assert.match(
    sql,
    /No se puede identificar sin ambiguedad el origen de un cursor round robin/
  )
})

test('registra la versión 005 sin borrar datos operativos', () => {
  assert.match(
    sql,
    /'005_link_portfolio_to_origins'/
  )
  assert.doesNotMatch(sql, /DROP TABLE/i)
  assert.doesNotMatch(sql, /TRUNCATE/i)
  assert.doesNotMatch(sql, /DELETE FROM public\.cartera_/i)
  assert.match(sql, /^BEGIN;/)
  assert.match(sql, /COMMIT;\s*$/)
})
