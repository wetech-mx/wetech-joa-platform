'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  LeadSecurityError,
  assignLead,
  getLeadHistory,
  importLeadRows,
  listActiveExecutives,
  listLeads,
  normalizeDate,
  normalizeState,
  updateLeadState
} = require('../repositories/leads-repository')
const {
  ROLES
} = require('../config/constants')

function session(role = ROLES.ADMIN) {
  return {
    id: 9,
    empresa_id: 7,
    rol: role
  }
}

function mockPool(responses) {
  const calls = []

  return {
    calls,
    async query(text, values) {
      calls.push({ text, values })
      const response = responses.shift()

      if (!response) {
        throw new Error('Respuesta de prueba no configurada')
      }

      return response
    }
  }
}

function transactionalPool(responses) {
  const calls = []
  const client = {
    released: false,
    async query(text, values) {
      calls.push({ text, values })
      const response = responses.shift()

      if (!response) {
        throw new Error('Respuesta transaccional no configurada')
      }

      return response
    },
    release() {
      this.released = true
    }
  }

  return {
    calls,
    client,
    async connect() {
      return client
    }
  }
}

test('rechaza estados de lead no autorizados', () => {
  assert.throws(
    () => normalizeState('Estado inventado'),
    error => error.code === 'LEAD_STATE_INVALID'
  )
})

test('rechaza fechas de seguimiento imposibles', () => {
  assert.throws(
    () => normalizeDate('2026-02-29'),
    error => error.code === 'LEAD_DATE_INVALID'
  )
})

test('un Administrador consulta únicamente su empresa', async () => {
  const pool = mockPool([{ rows: [] }])

  await listLeads({
    pool,
    usuario: session()
  })

  assert.match(pool.calls[0].text, /l\.empresa_id = \$1/)
  assert.doesNotMatch(pool.calls[0].text, /l\.usuario_id = \$2/)
  assert.deepEqual(pool.calls[0].values, [7])
})

test('un Ejecutivo consulta únicamente sus leads asignados', async () => {
  const pool = mockPool([{ rows: [] }])

  await listLeads({
    pool,
    usuario: session(ROLES.EJECUTIVO)
  })

  assert.match(pool.calls[0].text, /l\.empresa_id = \$1/)
  assert.match(pool.calls[0].text, /l\.usuario_id = \$2/)
  assert.deepEqual(pool.calls[0].values, [7, 9])
})

test('la lista de asignación contiene solo Ejecutivos activos de la empresa', async () => {
  const pool = mockPool([{ rows: [] }])

  await listActiveExecutives({
    pool,
    usuario: session()
  })

  assert.match(pool.calls[0].text, /empresa_id = \$1/)
  assert.match(pool.calls[0].text, /rol = \$2/)
  assert.match(pool.calls[0].text, /activo = TRUE/)
  assert.deepEqual(pool.calls[0].values, [7, ROLES.EJECUTIVO])
})

test('no revela historial de un lead fuera del alcance', async () => {
  const pool = mockPool([{ rows: [] }])

  await assert.rejects(
    getLeadHistory({
      pool,
      usuario: session(),
      leadId: 33
    }),
    error => (
      error.code === 'LEAD_NOT_FOUND'
      && error.status === 404
    )
  )

  assert.match(pool.calls[0].text, /l\.empresa_id = \$2/)
  assert.deepEqual(pool.calls[0].values, [33, 7])
})

test('actualiza y registra historial en una sola sentencia con alcance', async () => {
  const pool = mockPool([
    {
      rows: [
        {
          lead_id: 33
        }
      ]
    }
  ])

  await updateLeadState({
    pool,
    usuario: session(ROLES.EJECUTIVO),
    leadId: 33,
    estado: 'Contactado'
  })

  assert.match(pool.calls[0].text, /WITH updated AS/)
  assert.match(pool.calls[0].text, /l\.empresa_id = \$3/)
  assert.match(pool.calls[0].text, /l\.usuario_id = \$4/)
  assert.deepEqual(
    pool.calls[0].values.slice(0, 5),
    ['Contactado', 33, 7, 9, 9]
  )
})

test('un Ejecutivo no puede reasignar leads', async () => {
  await assert.rejects(
    assignLead({
      pool: {},
      usuario: session(ROLES.EJECUTIVO),
      leadId: 33,
      usuarioId: 12
    }),
    error => (
      error.code === 'LEAD_ASSIGN_FORBIDDEN'
      && error.status === 403
    )
  )
})

test('la asignación valida Ejecutivo, empresa y lead en transacción', async () => {
  const pool = transactionalPool([
    { rows: [] },
    { rows: [{ id: 12, nombre: 'Ejecutivo de prueba' }] },
    { rows: [{ id: 33 }] },
    { rows: [] },
    { rows: [] }
  ])

  await assignLead({
    pool,
    usuario: session(),
    leadId: 33,
    usuarioId: 12
  })

  assert.equal(pool.calls[0].text, 'BEGIN')
  assert.match(pool.calls[1].text, /empresa_id = \$2/)
  assert.deepEqual(
    pool.calls[1].values,
    [12, 7, ROLES.EJECUTIVO]
  )
  assert.match(pool.calls[2].text, /empresa_id = \$3/)
  assert.equal(pool.calls.at(-1).text, 'COMMIT')
  assert.equal(pool.client.released, true)
})

test('la importación fuerza empresa desde la sesión', async () => {
  const pool = transactionalPool([
    { rows: [] },
    { rows: [] },
    { rows: [] },
    { rows: [] }
  ])

  const result = await importLeadRows({
    pool,
    usuario: session(),
    rows: [
      {
        nombre: 'Registro controlado',
        email: 'controlado@example.test',
        telefono: '0000000000',
        empresa_id: 999
      }
    ]
  })

  assert.equal(result.importados, 1)
  assert.deepEqual(
    pool.calls[1].values,
    [7, 'controlado@example.test', '0000000000']
  )
  assert.equal(pool.calls[2].values.at(-1), 7)
  assert.equal(pool.calls.at(-1).text, 'COMMIT')
})

test('conserva el error controlado del repositorio', () => {
  const error = new LeadSecurityError('CODE', 'Mensaje', 403)

  assert.equal(error.code, 'CODE')
  assert.equal(error.status, 403)
})
