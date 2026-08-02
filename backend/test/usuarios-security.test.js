'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createUser,
  deactivateUser,
  listUsers,
  normalizeUserInput,
  resolveUserScope,
  updateUser
} = require('../repositories/usuarios-repository')
const {
  ROLES
} = require('../config/constants')

function session(role = ROLES.ADMIN) {
  return {
    id: 3,
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

      if (response instanceof Error) {
        throw response
      }

      if (!response) {
        throw new Error('Respuesta de prueba no configurada')
      }

      return response
    }
  }
}

test('rechaza roles inexistentes como Supervisor', () => {
  assert.throws(
    () => normalizeUserInput({
      nombre: 'Usuario controlado',
      email: 'controlado@example.test',
      rol: 'Supervisor'
    }),
    error => error.code === 'USER_ROLE_INVALID'
  )
})

test('exige contraseña robusta al crear usuario', () => {
  assert.throws(
    () => normalizeUserInput({
      nombre: 'Usuario controlado',
      email: 'controlado@example.test',
      password: 'corta',
      rol: ROLES.EJECUTIVO
    }, {
      requirePassword: true
    }),
    error => error.code === 'USER_PASSWORD_INVALID'
  )
})

test('un Ejecutivo no puede administrar usuarios', () => {
  assert.throws(
    () => resolveUserScope(session(ROLES.EJECUTIVO)),
    error => (
      error.code === 'USER_MANAGEMENT_FORBIDDEN'
      && error.status === 403
    )
  )
})

test('lista usuarios únicamente dentro de la empresa', async () => {
  const pool = mockPool([{ rows: [] }])

  await listUsers({
    pool,
    usuario: session()
  })

  assert.match(pool.calls[0].text, /WHERE empresa_id = \$1/)
  assert.deepEqual(pool.calls[0].values, [7])
})

test('crea usuario forzando la empresa de la sesión', async () => {
  const pool = mockPool([
    {
      rows: [
        {
          id: 10
        }
      ]
    }
  ])

  await createUser({
    pool,
    usuario: session(),
    input: {
      name: 'Usuario controlado',
      email: 'controlado@example.test',
      role: ROLES.EJECUTIVO
    },
    passwordHash: 'hash-controlado'
  })

  assert.equal(pool.calls[0].values.at(-1), 7)
  assert.doesNotMatch(pool.calls[0].text, /RETURNING.*password_hash/s)
})

test('actualiza usuario solo en empresa y protege super_admin', async () => {
  const pool = mockPool([
    {
      rows: [
        {
          id: 10
        }
      ]
    }
  ])

  await updateUser({
    pool,
    usuario: session(),
    userId: 10,
    input: {
      name: 'Usuario controlado',
      email: 'controlado@example.test',
      role: ROLES.ADMIN
    }
  })

  assert.match(pool.calls[0].text, /empresa_id = \$5/)
  assert.match(pool.calls[0].text, /rol <> \$6/)
  assert.equal(pool.calls[0].values[4], 7)
  assert.equal(pool.calls[0].values[5], ROLES.SUPER_ADMIN)
})

test('impide desactivar la propia cuenta', async () => {
  await assert.rejects(
    deactivateUser({
      pool: {},
      usuario: session(),
      userId: 3
    }),
    error => (
      error.code === 'USER_SELF_DEACTIVATION_FORBIDDEN'
      && error.status === 403
    )
  )
})

test('desactiva sin borrar y dentro de la empresa', async () => {
  const pool = mockPool([
    {
      rows: [
        {
          id: 10
        }
      ]
    }
  ])

  await deactivateUser({
    pool,
    usuario: session(),
    userId: 10
  })

  assert.match(pool.calls[0].text, /SET activo = FALSE/)
  assert.doesNotMatch(pool.calls[0].text, /DELETE FROM/)
  assert.deepEqual(
    pool.calls[0].values,
    [10, 7, ROLES.SUPER_ADMIN]
  )
})

test('traduce correo duplicado a conflicto controlado', async () => {
  const duplicate = new Error('duplicate')
  duplicate.code = '23505'
  const pool = mockPool([duplicate])

  await assert.rejects(
    createUser({
      pool,
      usuario: session(),
      input: {
        name: 'Usuario controlado',
        email: 'controlado@example.test',
        role: ROLES.EJECUTIVO
      },
      passwordHash: 'hash-controlado'
    }),
    error => (
      error.code === 'USER_EMAIL_DUPLICATE'
      && error.status === 409
    )
  )
})
