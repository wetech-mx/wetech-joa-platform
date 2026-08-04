'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const migrationPath = path.join(
  __dirname,
  '../migrations/006_create_integration_execution_history.sql'
)
const sql = fs.readFileSync(migrationPath, 'utf8')

test('requiere la relación multi-origen de la migración 005', () => {
  assert.match(
    sql,
    /WHERE version = '005_link_portfolio_to_origins'/
  )
  assert.match(
    sql,
    /La migracion 005_link_portfolio_to_origins no esta aplicada/
  )
})

test('crea historial aislado por empresa origen e integración', () => {
  assert.match(
    sql,
    /CREATE TABLE public\.crm_integracion_ejecuciones/
  )
  assert.match(
    sql,
    /FOREIGN KEY \([\s\S]*empresa_id,[\s\S]*origen_id,[\s\S]*integracion_id[\s\S]*\)[\s\S]*REFERENCES public\.crm_integraciones/
  )
})

test('distingue sin datos de una falla técnica', () => {
  for (const status of [
    'iniciada',
    'completada',
    'sin_datos',
    'fallida',
    'omitida'
  ]) {
    assert.match(sql, new RegExp(`'${status}'`))
  }

  assert.match(
    sql,
    /estado NOT IN \('fallida', 'sin_datos'\)[\s\S]*error_codigo IS NULL/
  )
})

test('registra tiempos conteos y métricas operativas', () => {
  for (const field of [
    'iniciada_at',
    'finalizada_at',
    'duracion_ms',
    'registros_recibidos',
    'registros_procesados',
    'metricas',
    'error_codigo'
  ]) {
    assert.match(sql, new RegExp(field))
  }
})

test('impide dos ejecuciones activas del mismo conector', () => {
  assert.match(
    sql,
    /CREATE UNIQUE INDEX ux_crm_integracion_ejecuciones_activa[\s\S]*WHERE estado = 'iniciada'/
  )
})

test('el repositorio contempla recuperación de ejecuciones interrumpidas', () => {
  const repositoryPath = path.join(
    __dirname,
    '../repositories/integration-execution-repository.js'
  )
  const repository = fs.readFileSync(repositoryPath, 'utf8')

  assert.match(
    repository,
    /INTEGRATION_EXECUTION_INTERRUPTED/
  )
  assert.match(
    repository,
    /INTERVAL '2 hours'/
  )
  assert.match(repository, /FOR UPDATE/)
})

test('documenta que no guarda secretos ni mensajes crudos', () => {
  assert.match(
    sql,
    /nunca credenciales, tokens ni mensajes de error crudos/
  )
  assert.match(
    sql,
    /Codigo controlado sin mensajes, respuestas ni valores sensibles/
  )
  assert.doesNotMatch(sql, /error_mensaje/i)
  assert.doesNotMatch(sql, /respuesta_cuerpo/i)
})

test('registra la versión 006 transaccionalmente', () => {
  assert.match(sql, /^BEGIN;/)
  assert.match(
    sql,
    /'006_create_integration_execution_history'/
  )
  assert.match(
    sql,
    /ON CONFLICT \(version\) DO NOTHING/
  )
  assert.match(sql, /COMMIT;\s*$/)
})
