const test = require('node:test')
const assert = require('node:assert/strict')

const {
  CARTERA_ESTADOS,
  ROLES
} = require('../config/constants')

const {
  addPortfolioNote,
  normalizeRequiredText,
  normalizeState,
  reassignPortfolioAccount,
  updatePortfolioState
} = require(
  '../repositories/cartera-management-repository'
)

function transactionPool(handler) {
  const calls = []

  const client = {
    released: false,
    async query(text, values) {
      const normalized = String(text).trim()

      calls.push({
        text: normalized,
        values
      })

      if (
        normalized === 'BEGIN'
        || normalized === 'COMMIT'
        || normalized === 'ROLLBACK'
      ) {
        return {
          rows: []
        }
      }

      return handler(normalized, values, calls)
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

function admin() {
  return {
    id: 1,
    empresa_id: 7,
    rol: ROLES.SUPER_ADMIN
  }
}

function executive(id = 12) {
  return {
    id,
    empresa_id: 7,
    rol: ROLES.EJECUTIVO
  }
}

test('publica el catálogo autorizado de estados', () => {
  assert.deepEqual(
    Object.values(CARTERA_ESTADOS),
    [
      'sin_gestionar',
      'contactado',
      'no_localizado',
      'seguimiento',
      'promesa_pago',
      'promesa_incumplida',
      'convenio',
      'pago_realizado',
      'rechazo_pago',
      'datos_incorrectos',
      'cerrado'
    ]
  )
})

test('rechaza una nota vacía', () => {
  assert.throws(
    () => normalizeRequiredText(
      '   ',
      {
        field: 'nota',
        maximum: 2000
      }
    ),
    error => (
      error.code === 'CARTERA_TEXT_REQUIRED'
    )
  )
})

test('rechaza un estado fuera del catálogo', () => {
  assert.throws(
    () => normalizeState('inventado'),
    error => (
      error.code === 'CARTERA_STATE_INVALID'
    )
  )
})

test('Ejecutivo agrega nota solo con asignación activa', async () => {
  const pool = transactionPool(
    async text => {
      if (text.includes('FROM public.cartera_cuentas')) {
        assert.match(
          text,
          /cartera_asignaciones/
        )

        return {
          rows: [
            {
              id: '101',
              estado_gestion: 'sin_gestionar'
            }
          ]
        }
      }

      if (text.includes('INSERT INTO public.cartera_historial')) {
        return {
          rows: [
            {
              id: '501',
              evento: 'nota_agregada'
            }
          ]
        }
      }

      throw new Error('SQL no esperado')
    }
  )

  const result = await addPortfolioNote({
    pool,
    usuario: executive(),
    accountId: '101',
    note: '  Nota controlada  '
  })

  assert.equal(
    result.note.evento,
    'nota_agregada'
  )
  assert.equal(
    pool.calls.at(-1).text,
    'COMMIT'
  )
  assert.equal(pool.client.released, true)
})

test('hace rollback si la cuenta no está al alcance', async () => {
  const pool = transactionPool(
    async text => {
      if (text.includes('FROM public.cartera_cuentas')) {
        return {
          rows: []
        }
      }

      throw new Error('SQL no esperado')
    }
  )

  await assert.rejects(
    addPortfolioNote({
      pool,
      usuario: executive(),
      accountId: '101',
      note: 'Nota controlada'
    }),
    error => (
      error.code ===
      'CARTERA_ACCOUNT_NOT_FOUND'
    )
  )

  assert.equal(
    pool.calls.at(-1).text,
    'ROLLBACK'
  )
})

test('conserva el estado si no cambió', async () => {
  const pool = transactionPool(
    async text => {
      if (text.includes('FROM public.cartera_cuentas')) {
        return {
          rows: [
            {
              id: '101',
              estado_gestion: 'seguimiento'
            }
          ]
        }
      }

      throw new Error('SQL no esperado')
    }
  )

  const result = await updatePortfolioState({
    pool,
    usuario: admin(),
    accountId: '101',
    state: 'seguimiento'
  })

  assert.equal(result.changed, false)
  assert.equal(
    pool.calls.at(-1).text,
    'COMMIT'
  )
})

test('actualiza estado y registra auditoría', async () => {
  const pool = transactionPool(
    async (text, values) => {
      if (text.includes('FROM public.cartera_cuentas')) {
        return {
          rows: [
            {
              id: '101',
              estado_gestion: 'sin_gestionar'
            }
          ]
        }
      }

      if (text.startsWith('UPDATE public.cartera_cuentas')) {
        assert.equal(values[1], 'contactado')

        return {
          rows: [
            {
              id: '101',
              estado_gestion: 'contactado'
            }
          ]
        }
      }

      if (text.includes('INSERT INTO public.cartera_historial')) {
        assert.match(values[3], /sin_gestionar/)
        assert.match(values[4], /contactado/)

        return {
          rows: [
            {
              id: '502'
            }
          ]
        }
      }

      throw new Error('SQL no esperado')
    }
  )

  const result = await updatePortfolioState({
    pool,
    usuario: admin(),
    accountId: '101',
    state: 'contactado',
    detail: 'Contacto validado'
  })

  assert.equal(result.changed, true)
  assert.equal(result.historyId, '502')
})

test('Ejecutivo no puede reasignar cuentas', async () => {
  const pool = transactionPool(
    async () => {
      throw new Error('No debe consultar PostgreSQL')
    }
  )

  await assert.rejects(
    reassignPortfolioAccount({
      pool,
      usuario: executive(),
      accountId: '101',
      executiveId: 13,
      reason: 'Cambio controlado'
    }),
    error => (
      error.code ===
      'CARTERA_REASSIGN_FORBIDDEN'
      && error.status === 403
    )
  )

  assert.equal(pool.calls.length, 0)
})

test('rechaza Ejecutivo de otra empresa o inactivo', async () => {
  const pool = transactionPool(
    async text => {
      if (text.includes('FROM public.cartera_cuentas')) {
        return {
          rows: [
            {
              id: '101',
              estado_gestion: 'sin_gestionar'
            }
          ]
        }
      }

      if (text.includes('FROM public.usuarios')) {
        return {
          rows: []
        }
      }

      throw new Error('SQL no esperado')
    }
  )

  await assert.rejects(
    reassignPortfolioAccount({
      pool,
      usuario: admin(),
      accountId: '101',
      executiveId: 13,
      reason: 'Cambio controlado'
    }),
    error => (
      error.code ===
      'CARTERA_EXECUTIVE_INVALID'
    )
  )

  assert.equal(
    pool.calls.at(-1).text,
    'ROLLBACK'
  )
})

test('rechaza reasignación al mismo Ejecutivo', async () => {
  const pool = transactionPool(
    async text => {
      if (text.includes('FROM public.cartera_cuentas')) {
        return {
          rows: [
            {
              id: '101',
              estado_gestion: 'sin_gestionar'
            }
          ]
        }
      }

      if (text.includes('FROM public.usuarios')) {
        return {
          rows: [
            {
              id: 13
            }
          ]
        }
      }

      if (text.includes('FROM public.cartera_asignaciones')) {
        return {
          rows: [
            {
              id: '201',
              usuario_id: 13
            }
          ]
        }
      }

      throw new Error('SQL no esperado')
    }
  )

  await assert.rejects(
    reassignPortfolioAccount({
      pool,
      usuario: admin(),
      accountId: '101',
      executiveId: 13,
      reason: 'Cambio controlado'
    }),
    error => (
      error.code ===
      'CARTERA_EXECUTIVE_UNCHANGED'
      && error.status === 409
    )
  )

  assert.equal(
    pool.calls.at(-1).text,
    'ROLLBACK'
  )
})

test('Administrador reasigna y registra historial', async () => {
  const pool = transactionPool(
    async text => {
      if (text.includes('FROM public.cartera_cuentas')) {
        return {
          rows: [
            {
              id: '101',
              estado_gestion: 'sin_gestionar'
            }
          ]
        }
      }

      if (text.includes('FROM public.usuarios')) {
        return {
          rows: [
            {
              id: 13
            }
          ]
        }
      }

      if (text.includes('FROM public.cartera_asignaciones')) {
        return {
          rows: [
            {
              id: '201',
              usuario_id: 12
            }
          ]
        }
      }

      if (
        text.startsWith(
          'UPDATE public.cartera_asignaciones'
        )
      ) {
        return {
          rows: []
        }
      }

      if (
        text.startsWith(
          'INSERT INTO public.cartera_asignaciones'
        )
      ) {
        return {
          rows: [
            {
              id: '202',
              cuenta_id: '101',
              usuario_id: 13,
              metodo: 'reasignacion'
            }
          ]
        }
      }

      if (text.includes('INSERT INTO public.cartera_historial')) {
        return {
          rows: []
        }
      }

      throw new Error('SQL no esperado')
    }
  )

  const result = await reassignPortfolioAccount({
    pool,
    usuario: admin(),
    accountId: '101',
    executiveId: 13,
    reason: 'Balance de carga controlado'
  })

  assert.equal(
    result.assignment.metodo,
    'reasignacion'
  )
  assert.equal(
    pool.calls.at(-1).text,
    'COMMIT'
  )
})
