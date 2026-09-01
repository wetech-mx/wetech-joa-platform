'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { ROLES } = require('../config/constants')
const {
  closeOwnSession,
  closeSession,
  createSession,
  listSessions,
  normalizeSessionId,
  validateSession
} = require('../repositories/session-control-repository')

const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000'
const OTHER_SESSION_ID = '223e4567-e89b-42d3-a456-426614174000'

function session(role = ROLES.ADMIN) {
  return {
    id: 3,
    empresa_id: 7,
    rol: role,
    session_id: SESSION_ID
  }
}

function mockPool(responses) {
  const calls = []

  return {
    calls,
    async query(text, values) {
      calls.push({ text, values })
      const response = responses.shift()

      if (response instanceof Error) throw response
      if (!response) {
        throw new Error('Respuesta de prueba no configurada')
      }

      return response
    }
  }
}

function read(relativePath) {
  return fs.readFileSync(
    path.join(__dirname, '..', relativePath),
    'utf8'
  )
}

test('migración 010 registra sesiones sin borrar información', () => {
  const migration = read(
    'migrations/010_create_session_control.sql'
  )

  assert.match(migration, /CREATE TABLE public\.crm_sesiones/)
  assert.match(migration, /010_create_session_control/)
  assert.match(migration, /ultima_actividad_at/)
  assert.match(migration, /cierre_motivo/)
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE/)
})

test('normaliza UUID y rechaza identificadores arbitrarios', () => {
  assert.equal(normalizeSessionId(SESSION_ID), SESSION_ID)
  assert.throws(
    () => normalizeSessionId('1 OR 1=1'),
    error => error.code === 'SESSION_ID_INVALID'
  )
})

test('crea una sesión dentro de usuario y empresa', async () => {
  const pool = mockPool([{ rows: [] }])
  const expiresAt = new Date('2026-09-01T20:00:00.000Z')

  await createSession({
    pool,
    usuario: session(),
    sessionId: SESSION_ID,
    expiresAt,
    ipAddress: '203.0.113.10',
    userAgent: 'Navegador de prueba'
  })

  assert.match(pool.calls[0].text, /INSERT INTO public\.crm_sesiones/)
  assert.deepEqual(
    pool.calls[0].values,
    [
      SESSION_ID,
      7,
      3,
      '203.0.113.10',
      'Navegador de prueba',
      expiresAt
    ]
  )
})

test('valida en servidor cada token y registra actividad', async () => {
  const pool = mockPool([{ rows: [{ id: SESSION_ID }] }])

  assert.equal(await validateSession({
    pool,
    usuario: session(),
    sessionId: SESSION_ID
  }), true)

  assert.match(pool.calls[0].text, /WITH sesion_valida AS MATERIALIZED/)
  assert.match(pool.calls[0].text, /UPDATE public\.crm_sesiones/)
  assert.match(pool.calls[0].text, /u\.activo = TRUE/)
  assert.match(pool.calls[0].text, /s\.expira_at > NOW\(\)/)
  assert.deepEqual(
    pool.calls[0].values,
    [SESSION_ID, 3, 7, ROLES.ADMIN]
  )
})

test('rechaza una sesión cerrada o desconocida', async () => {
  const pool = mockPool([{ rows: [] }])

  await assert.rejects(
    validateSession({
      pool,
      usuario: session(),
      sessionId: SESSION_ID
    }),
    error => (
      error.code === 'SESSION_INACTIVE'
      && error.status === 401
    )
  )
})

test('un Ejecutivo no puede consultar el monitor', async () => {
  await assert.rejects(
    listSessions({
      pool: {
        async query() {
          throw new Error('No debe consultar PostgreSQL')
        }
      },
      usuario: session(ROLES.EJECUTIVO)
    }),
    error => (
      error.code === 'SESSION_ADMIN_FORBIDDEN'
      && error.status === 403
    )
  )
})

test('el monitor limita resultados a la empresa y marca sesión actual', async () => {
  const pool = mockPool([
    {
      rows: [
        {
          id: SESSION_ID,
          usuario_id: 3,
          usuario_nombre: 'Administrador',
          usuario_email: 'admin@example.test',
          usuario_rol: ROLES.ADMIN,
          activa: true,
          en_linea: true
        }
      ]
    }
  ])

  const result = await listSessions({
    pool,
    usuario: session()
  })

  assert.match(pool.calls[0].text, /s\.empresa_id = \$1/)
  assert.equal(pool.calls[0].values[0], 7)
  assert.equal(result[0].current, true)
  assert.equal(result[0].online, true)
  assert.equal(result[0].active, true)
})

test('impide que administración cierre su propia sesión desde el monitor', async () => {
  await assert.rejects(
    closeSession({
      pool: {},
      usuario: session(),
      sessionId: SESSION_ID
    }),
    error => (
      error.code === 'SESSION_SELF_CLOSE_FORBIDDEN'
      && error.status === 403
    )
  )
})

test('cierra otra sesión únicamente dentro de la empresa', async () => {
  const closedAt = new Date('2026-09-01T12:00:00.000Z')
  const pool = mockPool([
    {
      rows: [
        {
          id: OTHER_SESSION_ID,
          usuario_id: 12,
          cerrada_at: closedAt
        }
      ]
    }
  ])

  const result = await closeSession({
    pool,
    usuario: session(),
    sessionId: OTHER_SESSION_ID,
    reason: 'Equipo sin supervisión'
  })

  assert.match(pool.calls[0].text, /s\.empresa_id = \$4/)
  assert.equal(pool.calls[0].values[0], 3)
  assert.equal(pool.calls[0].values[1], 'Equipo sin supervisión')
  assert.equal(pool.calls[0].values[2], OTHER_SESSION_ID)
  assert.equal(pool.calls[0].values[3], 7)
  assert.equal(result.success, true)
})

test('cerrar sesión normal invalida exactamente el acceso actual', async () => {
  const pool = mockPool([{ rows: [] }])

  assert.deepEqual(await closeOwnSession({
    pool,
    usuario: session()
  }), { success: true })

  assert.match(pool.calls[0].text, /id = \$2/)
  assert.deepEqual(pool.calls[0].values, [3, SESSION_ID, 7])
})

test('login emite jti y registra la sesión antes de responder', () => {
  const controller = read('controllers/auth.controller.js')

  assert.match(controller, /crypto\.randomUUID\(\)/)
  assert.match(controller, /jwtid: sessionId/)
  assert.match(controller, /await createSession\(/)
  assert.match(controller, /SESSION_DURATION_HOURS = 12/)
})

test('las rutas de sesiones exigen autenticación y administración', () => {
  const routes = read('routes/auth.routes.js')

  assert.match(
    routes,
    /'\/logout',[\s\S]*verificaToken,[\s\S]*requiereEmpresa/
  )
  assert.match(
    routes,
    /'\/sesiones',[\s\S]*verificaToken,[\s\S]*requiereEmpresa,[\s\S]*requiereAdmin/
  )
  assert.match(
    routes,
    /'\/sesiones\/:id\/cerrar',[\s\S]*requiereAdmin/
  )
})

test('frontend muestra el monitor solo a roles administrativos', () => {
  const app = read('../frontend/src/App.jsx')
  const monitor = read('../frontend/src/SessionMonitor.jsx')

  assert.match(app, /setPantalla\('sesiones'\)/)
  assert.match(
    app,
    /pantalla === 'sesiones' && usuario\?\.rol !== 'Ejecutivo'/
  )
  assert.match(app, /'\/crm-api\/sesiones\/heartbeat'/)
  assert.match(app, /'\/crm-api\/logout'/)
  assert.match(monitor, /apiFetch\('\/crm-api\/sesiones'\)/)
  assert.match(
    monitor,
    /`\/crm-api\/sesiones\/\$\{selected\.id\}\/cerrar`/
  )
})
