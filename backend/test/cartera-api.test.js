const test = require('node:test')
const assert = require('node:assert/strict')

const {
  CarteraReadError,
  getPortfolioAccount,
  getPortfolioSummary,
  listPortfolioExecutives,
  listPortfolioOrigins,
  listPortfolio,
  normalizeBigintId,
  normalizeListFilters,
  resolveAccessScope,
  resolvePortfolioOrigin
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

test('conserva el origen BIGINT como texto', () => {
  const filters = normalizeListFilters({
    origen: '9007199254740993'
  })

  assert.equal(
    filters.originId,
    '9007199254740993'
  )
})

test('rechaza un origen con formato inválido', () => {
  assert.throws(
    () => normalizeListFilters({
      origen: '1 OR TRUE'
    }),
    error => (
      error.code === 'CARTERA_ID_INVALID'
    )
  )
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

test('filtra la cartera por un origen de la empresa', async () => {
  const pool = mockPool([
    {
      rows: [
        {
          id: '20',
          codigo: 'origen_controlado',
          nombre: 'Origen controlado',
          tipo: 'cliente_cobranza'
        }
      ]
    },
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
          id: '100',
          origen_id: '20'
        }
      ]
    }
  ])

  const result = await listPortfolio({
    pool,
    usuario: {
      id: 2,
      empresa_id: 7,
      rol: ROLES.ADMIN
    },
    query: {
      origen: '20'
    }
  })

  assert.equal(result.origin.id, '20')
  assert.equal(result.data.length, 1)
  assert.deepEqual(
    pool.calls[0].values,
    ['20', 7]
  )
  assert.match(
    pool.calls[1].text,
    /c\.origen_id/
  )
  assert.ok(
    pool.calls[1].values.includes('20')
  )
})

test('rechaza un origen ajeno a la empresa', async () => {
  const pool = mockPool([
    {
      rows: []
    }
  ])

  await assert.rejects(
    resolvePortfolioOrigin({
      pool,
      scope: {
        empresaId: 7
      },
      originId: '20'
    }),
    error => (
      error instanceof CarteraReadError
      && error.code ===
        'CARTERA_ORIGIN_NOT_FOUND'
      && error.status === 404
    )
  )

  assert.deepEqual(
    pool.calls[0].values,
    ['20', 7]
  )
})

test('resume la cartera activa de la empresa', async () => {
  const pool = mockPool([
    {
      rows: [
        {
          total_cuentas: '200',
          asignadas: '180',
          sin_asignar: '20',
          campanias: '2',
          saldo_total: '125000.50',
          pago_requerido_total: '31000.25',
          ultima_fecha_cartera: '2026-07-30'
        }
      ]
    },
    {
      rows: [
        {
          estado: 'sin_gestionar',
          total: '150'
        }
      ]
    },
    {
      rows: [
        {
          riesgo: 'Alto',
          total: '90'
        }
      ]
    },
    {
      rows: [
        {
          ejecutivo_id: '12',
          ejecutivo: 'Ejecutivo controlado',
          total: '100'
        }
      ]
    }
  ])

  const result = await getPortfolioSummary({
    pool,
    usuario: {
      id: 2,
      empresa_id: 7,
      rol: ROLES.ADMIN
    }
  })

  assert.equal(result.scope, 'empresa')
  assert.deepEqual(result.totals, {
    accounts: 200,
    assigned: 180,
    unassigned: 20,
    campaigns: 2,
    balance: '125000.50',
    requiredPayment: '31000.25',
    portfolioDate: '2026-07-30'
  })
  assert.deepEqual(result.states, [
    {
      state: 'sin_gestionar',
      total: 150
    }
  ])
  assert.equal(pool.calls.length, 4)

  for (const call of pool.calls) {
    assert.match(call.text, /c\.empresa_id = \$1/)
    assert.deepEqual(call.values, [7])
  }
})

test('filtra el resumen por origen validado', async () => {
  const pool = mockPool([
    {
      rows: [
        {
          id: '20',
          codigo: 'origen_controlado',
          nombre: 'Origen controlado',
          tipo: 'cliente_cobranza'
        }
      ]
    },
    {
      rows: [
        {
          total_cuentas: '0',
          asignadas: '0',
          sin_asignar: '0',
          campanias: '0',
          saldo_total: '0',
          pago_requerido_total: '0',
          ultima_fecha_cartera: null
        }
      ]
    },
    {
      rows: []
    },
    {
      rows: []
    },
    {
      rows: []
    }
  ])

  const result = await getPortfolioSummary({
    pool,
    usuario: {
      id: 2,
      empresa_id: 7,
      rol: ROLES.ADMIN
    },
    query: {
      origen: '20'
    }
  })

  assert.equal(result.origin.id, '20')

  for (const call of pool.calls.slice(1)) {
    assert.match(call.text, /c\.origen_id = \$2/)
    assert.deepEqual(call.values, [7, '20'])
  }
})

test('el resumen de Ejecutivo conserva su alcance', async () => {
  const pool = mockPool([
    {
      rows: [
        {
          total_cuentas: '10',
          asignadas: '10',
          sin_asignar: '0',
          campanias: '1',
          saldo_total: '5000',
          pago_requerido_total: '1000',
          ultima_fecha_cartera: '2026-07-30'
        }
      ]
    },
    {
      rows: []
    },
    {
      rows: []
    },
    {
      rows: []
    }
  ])

  const result = await getPortfolioSummary({
    pool,
    usuario: {
      id: 12,
      empresa_id: 7,
      rol: ROLES.EJECUTIVO
    }
  })

  assert.equal(result.scope, 'ejecutivo')

  for (const call of pool.calls) {
    assert.match(call.text, /a\.usuario_id = \$2/)
    assert.deepEqual(call.values, [7, 12])
  }
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

test('lista orígenes activos sin exponer referencias secretas', async () => {
  const pool = mockPool([
    {
      rows: [
        {
          id: '20',
          codigo: 'banco_azteca',
          nombre: 'Banco Azteca',
          tipo: 'cliente_cobranza',
          descripcion: 'Origen controlado',
          integraciones_activas: 1
        }
      ]
    }
  ])

  const result = await listPortfolioOrigins({
    pool,
    usuario: {
      id: 1,
      empresa_id: 7,
      rol: ROLES.SUPER_ADMIN
    }
  })

  assert.equal(result.length, 1)
  assert.deepEqual(pool.calls[0].values, [7])
  assert.match(
    pool.calls[0].text,
    /o\.empresa_id = \$1/
  )
  assert.doesNotMatch(
    pool.calls[0].text,
    /referencia_secreto|configuracion_no_secreta/
  )
})
