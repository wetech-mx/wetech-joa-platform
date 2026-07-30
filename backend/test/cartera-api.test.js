const test = require('node:test')
const assert = require('node:assert/strict')

const {
  CarteraReadError,
  getPortfolioAccount,
  listPortfolioExecutives,
  listPortfolio,
  normalizeBigintId,
  normalizeListFilters,
  resolveAccessScope
} = require('../repositories/cartera-read-repository')

const {
  ROLES
} = require('../config/constants')

function mockPool(responses) {
  const calls = []

  return {
    calls,
    async query(text, values) {
      calls.push({
        text,
        values
      })

      const response = responses.shift()

      if (!response) {
        throw new Error(
          'La prueba no configuró una respuesta'
        )
      }

      return response
    }
  }
}

test('define paginación segura por defecto', () => {
  const filters = normalizeListFilters({})

  assert.equal(filters.page, 1)
  assert.equal(filters.limit, 25)
  assert.equal(filters.active, true)
})

test('limita cada página a un máximo de 100', () => {
  const filters = normalizeListFilters({
    page: '2',
    limit: '500'
  })

  assert.equal(filters.page, 2)
  assert.equal(filters.limit, 100)
})

test('rechaza una fecha de filtro imposible', () => {
  assert.throws(
    () => normalizeListFilters({
      fecha: '2026-02-29'
    }),
    error => (
      error.code ===
      'CARTERA_QUERY_DATE_INVALID'
    )
  )
})

test('rechaza valores inválidos del filtro activa', () => {
  assert.throws(
    () => normalizeListFilters({
      activa: 'quizas'
    }),
    error => (
      error.code ===
      'CARTERA_QUERY_ACTIVE_INVALID'
    )
  )
})

test('conserva identificadores BIGINT como texto', () => {
  assert.equal(
    normalizeBigintId('9007199254740993'),
    '9007199254740993'
  )
})

test('rechaza identificadores mayores a BIGINT', () => {
  assert.throws(
    () => normalizeBigintId(
      '9223372036854775808'
    ),
    error => (
      error.code === 'CARTERA_ID_INVALID'
    )
  )
})

test('requiere empresa dentro de la sesión', () => {
  assert.throws(
    () => resolveAccessScope({
      id: 3,
      rol: ROLES.ADMIN
    }),
    error => (
      error.code ===
      'CARTERA_COMPANY_REQUIRED'
      && error.status === 403
    )
  )
})

test('rechaza roles desconocidos', () => {
  assert.throws(
    () => resolveAccessScope({
      id: 3,
      empresa_id: 7,
      rol: 'rol_desconocido'
    }),
    error => (
      error.code ===
      'CARTERA_ROLE_FORBIDDEN'
      && error.status === 403
    )
  )
})

test('un Ejecutivo solo consulta sus asignaciones', async () => {
  const pool = mockPool([
    {
      rows: [
        {
          total: '1'
        }
      ]
    },
    {
      rows: [
        {
          id: '100'
        }
      ]
    }
  ])

  const result = await listPortfolio({
    pool,
    usuario: {
      id: 12,
      empresa_id: 7,
      rol: ROLES.EJECUTIVO
    },
    query: {
      ejecutivo: '99'
    }
  })

  assert.equal(result.data.length, 1)
  assert.match(
    pool.calls[0].text,
    /a\.usuario_id/
  )
  assert.ok(
    pool.calls[0].values.includes(12)
  )
  assert.ok(
    !pool.calls[0].values.includes(99)
  )
})

test('un Administrador puede filtrar por Ejecutivo', async () => {
  const pool = mockPool([
    {
      rows: [
        {
          total: '0'
        }
      ]
    },
    {
      rows: []
    }
  ])

  await listPortfolio({
    pool,
    usuario: {
      id: 2,
      empresa_id: 7,
      rol: ROLES.ADMIN
    },
    query: {
      ejecutivo: '99',
      activa: 'todas'
    }
  })

  assert.ok(
    pool.calls[0].values.includes(99)
  )
})

test('parametriza el texto de búsqueda', async () => {
  const dangerous =
    "cliente' OR TRUE --"

  const pool = mockPool([
    {
      rows: [
        {
          total: '0'
        }
      ]
    },
    {
      rows: []
    }
  ])

  await listPortfolio({
    pool,
    usuario: {
      id: 2,
      empresa_id: 7,
      rol: ROLES.ADMIN
    },
    query: {
      busqueda: dangerous
    }
  })

  assert.doesNotMatch(
    pool.calls[0].text,
    /cliente' OR TRUE/
  )
  assert.ok(
    pool.calls[0].values.includes(
      `%${dangerous}%`
    )
  )
})

test('devuelve 404 si la cuenta no pertenece al alcance', async () => {
  const pool = mockPool([
    {
      rows: []
    }
  ])

  await assert.rejects(
    getPortfolioAccount({
      pool,
      usuario: {
        id: 2,
        empresa_id: 7,
        rol: ROLES.ADMIN
      },
      accountId: '123'
    }),
    error => (
      error instanceof CarteraReadError
      && error.code ===
        'CARTERA_ACCOUNT_NOT_FOUND'
      && error.status === 404
    )
  )

  assert.equal(pool.calls.length, 1)
})

test('devuelve detalle e historial de una cuenta válida', async () => {
  const pool = mockPool([
    {
      rows: [
        {
          id: '123',
          nombre: 'Cuenta controlada'
        }
      ]
    },
    {
      rows: [
        {
          id: '5',
          evento: 'importada'
        }
      ]
    }
  ])

  const result = await getPortfolioAccount({
    pool,
    usuario: {
      id: 2,
      empresa_id: 7,
      rol: ROLES.ADMIN
    },
    accountId: '123'
  })

  assert.equal(result.account.id, '123')
  assert.equal(result.history.length, 1)
  assert.equal(pool.calls.length, 2)
})

test('lista únicamente Ejecutivos activos de la empresa', async () => {
  const pool = mockPool([
    {
      rows: [
        {
          id: 12,
          nombre: 'Ejecutivo controlado'
        }
      ]
    }
  ])

  const result = await listPortfolioExecutives({
    pool,
    usuario: {
      id: 1,
      empresa_id: 7,
      rol: ROLES.SUPER_ADMIN
    }
  })

  assert.equal(result.length, 1)
  assert.match(
    pool.calls[0].text,
    /empresa_id = \$1/
  )
  assert.match(
    pool.calls[0].text,
    /activo = TRUE/
  )
  assert.deepEqual(
    pool.calls[0].values,
    [
      7,
      ROLES.EJECUTIVO
    ]
  )
})
