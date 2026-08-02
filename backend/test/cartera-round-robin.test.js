const test = require('node:test')
const assert = require('node:assert/strict')

const {
  EJECUTIVO_ROLE,
  assignRoundRobin,
  chooseNextExecutive
} = require('../importers/cartera-round-robin')

const ORIGIN_ID = 8

function fakeClient({
  accountExists = true,
  existingAssignment = null,
  executiveIds = [
    10,
    20,
    30
  ],
  lastExecutiveId = null,
  assignmentId = 500
} = {}) {
  const calls = []

  return {
    calls,
    async query(sql, params = []) {
      const compact = String(sql)
        .replace(/\s+/g, ' ')
        .trim()

      calls.push({
        sql: compact,
        params
      })

      if (
        compact.startsWith(
          'SELECT id FROM public.cartera_cuentas'
        )
      ) {
        return {
          rows: accountExists
            ? [
              {
                id: params[0]
              }
            ]
            : []
        }
      }

      if (
        compact.includes(
          'FROM public.cartera_asignaciones'
        )
      ) {
        return {
          rows: existingAssignment
            ? [existingAssignment]
            : []
        }
      }

      if (
        compact.includes('FROM public.usuarios')
      ) {
        return {
          rows: executiveIds.map(id => ({
            id
          }))
        }
      }

      if (
        compact.startsWith(
          'SELECT ultimo_usuario_id'
        )
      ) {
        return {
          rows: [
            {
              ultimo_usuario_id: lastExecutiveId
            }
          ]
        }
      }

      if (
        compact.startsWith(
          'INSERT INTO public.cartera_asignaciones'
        )
      ) {
        return {
          rows: [
            {
              id: assignmentId
            }
          ]
        }
      }

      return {
        rows: []
      }
    }
  }
}

test('selecciona al ejecutivo siguiente', () => {
  assert.equal(
    chooseNextExecutive([
      10,
      20,
      30
    ], 10),
    20
  )
})

test('reinicia la ronda después del último ejecutivo', () => {
  assert.equal(
    chooseNextExecutive([
      10,
      20,
      30
    ], 30),
    10
  )
})

test('inicia con el primero si el cursor quedó obsoleto', () => {
  assert.equal(
    chooseNextExecutive([
      10,
      20,
      30
    ], 99),
    10
  )
})

test('falla si no existen ejecutivos activos', () => {
  assert.throws(
    () => chooseNextExecutive([], null),
    error => (
      error.code === 'BAZ_ASSIGN_NO_EXECUTIVES'
    )
  )
})

test('conserva una asignación activa existente', async () => {
  const client = fakeClient({
    existingAssignment: {
      id: 700,
      usuario_id: 20
    }
  })

  const result = await assignRoundRobin({
    client,
    empresaId: 7,
    origenId: ORIGIN_ID,
    cuentaId: 100,
    idCampania: 'CAMP-1'
  })

  assert.deepEqual(result, {
    status: 'kept',
    asignacionId: 700,
    usuarioId: 20
  })
  assert.equal(
    client.calls.some(call => (
      call.sql.includes('FROM public.usuarios')
    )),
    false
  )
})

test('asigna y actualiza el cursor de campaña', async () => {
  const client = fakeClient({
    lastExecutiveId: 10,
    assignmentId: 501
  })

  const result = await assignRoundRobin({
    client,
    empresaId: 7,
    origenId: ORIGIN_ID,
    cuentaId: 100,
    idCampania: ' CAMP-1 '
  })

  assert.deepEqual(result, {
    status: 'assigned',
    asignacionId: 501,
    usuarioId: 20
  })
  assert.equal(
    client.calls.some(call => (
      call.sql.startsWith(
        'UPDATE public.cartera_round_robin_estado'
      )
      && call.params[3] === 20
    )),
    true
  )
  assert.equal(
    client.calls.some(call => (
      call.sql.startsWith(
        'INSERT INTO public.cartera_historial'
      )
    )),
    true
  )
})

test('filtra por empresa, activo y rol Ejecutivo', async () => {
  const client = fakeClient()

  await assignRoundRobin({
    client,
    empresaId: 7,
    origenId: ORIGIN_ID,
    cuentaId: 100,
    idCampania: 'CAMP-1'
  })

  const usersQuery = client.calls.find(call => (
    call.sql.includes('FROM public.usuarios')
  ))

  assert.deepEqual(
    usersQuery.params,
    [
      7,
      EJECUTIVO_ROLE
    ]
  )
  assert.match(usersQuery.sql, /activo = TRUE/)
  assert.match(usersQuery.sql, /rol = \$2/)
})

test('bloquea cuenta y cursor antes de asignar', async () => {
  const client = fakeClient()

  await assignRoundRobin({
    client,
    empresaId: 7,
    origenId: ORIGIN_ID,
    cuentaId: 100,
    idCampania: 'CAMP-1'
  })

  const accountLockIndex = client.calls.findIndex(call => (
    call.sql.startsWith(
      'SELECT id FROM public.cartera_cuentas'
    )
    && call.sql.includes('FOR UPDATE')
  ))
  const stateLockIndex = client.calls.findIndex(call => (
    call.sql.startsWith(
      'SELECT ultimo_usuario_id'
    )
    && call.sql.includes('FOR UPDATE')
  ))
  const assignmentIndex = client.calls.findIndex(call => (
    call.sql.startsWith(
      'INSERT INTO public.cartera_asignaciones'
    )
  ))

  assert.equal(accountLockIndex >= 0, true)
  assert.equal(stateLockIndex >= 0, true)
  assert.equal(
    assignmentIndex > stateLockIndex,
    true
  )
  assert.deepEqual(
    client.calls[accountLockIndex].params,
    [
      100,
      7,
      ORIGIN_ID
    ]
  )

  const stateInsert = client.calls.find(call => (
    call.sql.startsWith(
      'INSERT INTO public.cartera_round_robin_estado'
    )
  ))

  assert.deepEqual(stateInsert.params, [
    7,
    ORIGIN_ID,
    'CAMP-1'
  ])
  assert.match(
    stateInsert.sql,
    /empresa_id, origen_id, id_campania/
  )
})

test('rechaza una cuenta inexistente', async () => {
  const client = fakeClient({
    accountExists: false
  })

  await assert.rejects(
    () => assignRoundRobin({
      client,
      empresaId: 7,
      origenId: ORIGIN_ID,
      cuentaId: 999,
      idCampania: 'CAMP-1'
    }),
    error => (
      error.code === 'BAZ_ASSIGN_ACCOUNT_NOT_FOUND'
    )
  )
})
