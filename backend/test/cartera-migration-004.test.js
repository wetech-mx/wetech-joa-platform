'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const migrationPath = path.join(
  __dirname,
  '../migrations/004_create_integration_catalogs.sql'
)

const sql = fs.readFileSync(
  migrationPath,
  'utf8'
)

test('crea catálogos multi-origen aislados por empresa', () => {
  assert.match(
    sql,
    /CREATE TABLE public\.crm_origenes/
  )
  assert.match(
    sql,
    /CREATE TABLE public\.crm_integraciones/
  )
  assert.match(
    sql,
    /UNIQUE \(empresa_id, codigo\)/
  )
  assert.match(
    sql,
    /FOREIGN KEY \(empresa_id, origen_id\)[\s\S]*REFERENCES public\.crm_origenes\(empresa_id, id\)/
  )
})

test('incluye conectores de archivos red bases de datos y Aspel', () => {
  for (const code of [
    'api_rest',
    'api_soap',
    'webhook',
    'sftp',
    'archivo_excel',
    'archivo_csv',
    'carpeta_compartida',
    'firebird',
    'sql_server',
    'odbc',
    'aspel_dac'
  ]) {
    assert.match(
      sql,
      new RegExp(`'${code}'`)
    )
  }
})

test('separa configuración pública de referencias a secretos', () => {
  assert.match(
    sql,
    /configuracion_no_secreta JSONB/
  )
  assert.match(
    sql,
    /referencia_secreto VARCHAR\(255\)/
  )
  assert.match(
    sql,
    /sin contraseñas, tokens ni llaves privadas/
  )
})

test('registra Banco Azteca como origen y no como empresa', () => {
  assert.match(
    sql,
    /'banco_azteca',[\s\S]*'Banco Azteca',[\s\S]*'cliente_cobranza'/
  )
  assert.match(
    sql,
    /FROM public\.empresas empresa[\s\S]*WHERE empresa\.id = 1/
  )
  assert.match(
    sql,
    /'banco_azteca_api'/
  )
})

test('la etapa 004 no altera las tablas operativas existentes', () => {
  assert.doesNotMatch(
    sql,
    /ALTER TABLE public\.cartera_/
  )
  assert.doesNotMatch(
    sql,
    /DROP (TABLE|COLUMN|CONSTRAINT)/
  )
})

test('registra la versión 004 de forma transaccional', () => {
  assert.match(sql, /^BEGIN;/)
  assert.match(sql, /004_create_integration_catalogs/)
  assert.match(
    sql,
    /ON CONFLICT \(version\) DO NOTHING/
  )
  assert.match(sql, /COMMIT;\s*$/)
})
