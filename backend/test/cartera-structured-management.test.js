const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  MANAGEMENT_CHANNELS,
  MANAGEMENT_RELATIONSHIPS,
  listPortfolioTypifications,
  normalizePortfolioManagement,
  registerPortfolioManagement
} = require(
  '../repositories/cartera-management-repository'
)

const {
  ROLES
} = require('../config/constants')

const NOW = new Date('2026-08-18T12:00:00.000Z')

function typification(overrides = {}) {
  return {
    id: '15',
    codigo: 'promesa_parcial',
    nombre: 'Promesa parcial',
    prioridad: 1,
    estado_resultante: 'promesa_pago',
    requiere_promesa: true,
    requiere_seguimiento: false,
    cierra_cuenta: false,
    ...overrides
  }
}

function input(overrides = {}) {
  return {
    tipificacion_id: '15',
    canal: 'telefono',
    telefono_contactado: '5512345678',
    persona_contactada: 'Cliente titular',
    relacion_contacto: 'titular',
    promesa_monto: '5033.50',
    promesa_fecha: '2026-08-19',
    proximo_seguimiento_at: null,
    notas: 'Promesa confirmada por el titular.',
    evidencia: null,
    ...overrides
  }
}

function executive() {
  return {
    id: 12,
    empresa_id: 7,
    rol: ROLES.EJECUTIVO
  }
}

function transactionPool(handler) {
  const calls = []
  const client = {
    released: false,
    async query(text, values) {
      const normalized = String(text).trim()
      calls.push({ text: normalized, values })

      if (
        normalized === 'BEGIN'
        || normalized === 'COMMIT'
        || normalized === 'ROLLBACK'
      ) {
        return { rows: [] }
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

test('publica canales y relaciones controlados', () => {
  assert.ok(MANAGEMENT_CHANNELS.has('telefono'))
  assert.ok(MANAGEMENT_CHANNELS.has('whatsapp'))
  assert.ok(MANAGEMENT_RELATIONSHIPS.has('titular'))
  assert.ok(MANAGEMENT_RELATIONSHIPS.has('referencia'))
})

test('normaliza una promesa completa desde el catálogo', () => {
  const result = normalizePortfolioManagement(
    input(),
    typification(),
    NOW
  )

  assert.equal(result.typification.code, 'promesa_parcial')
  assert.equal(result.typification.state, 'promesa_pago')
  assert.equal(result.promiseAmount, '5033.50')
  assert.equal(result.promiseDate, '2026-08-19')
})

test('exige monto y fecha cuando lo ordena la tipificación', () => {
  assert.throws(
    () => normalizePortfolioManagement(
      input({
        promesa_monto: null,
        promesa_fecha: null
      }),
      typification(),
      NOW
    ),
    error => error.code === 'CARTERA_PROMISE_AMOUNT_INVALID'
  )
})

test('exige seguimiento futuro cuando lo ordena el catálogo', () => {
  assert.throws(
    () => normalizePortfolioManagement(
      input({
        promesa_monto: null,
        promesa_fecha: null
      }),
      typification({
        codigo: 'seguimiento',
        nombre: 'Seguimiento',
        prioridad: 3,
        estado_resultante: 'seguimiento',
        requiere_promesa: false,
        requiere_seguimiento: true
      }),
      NOW
    ),
    error => error.code === 'CARTERA_FOLLOW_UP_REQUIRED'
  )
})

test('rechaza teléfono vacío en llamada, WhatsApp o SMS', () => {
  assert.throws(
    () => normalizePortfolioManagement(
      input({ telefono_contactado: null }),
      typification(),
      NOW
    ),
    error => error.code === 'CARTERA_MANAGEMENT_PHONE_REQUIRED'
  )
})

test('lista únicamente tipificaciones activas de la empresa', async () => {
  const calls = []
  const pool = {
    async query(text, values) {
      calls.push({ text, values })
      return {
        rows: [typification()]
      }
    }
  }

  const result = await listPortfolioTypifications({
    pool,
    usuario: executive()
  })

  assert.equal(result.data.length, 1)
  assert.deepEqual(calls[0].values, [7])
  assert.match(calls[0].text, /empresa_id = \$1/)
  assert.match(calls[0].text, /activa = TRUE/)
})

test('registra gestión y estado dentro de una transacción', async () => {
  const pool = transactionPool(
    async (text, values) => {
      if (text.includes('FROM public.cartera_cuentas')) {
        return {
          rows: [{
            id: '101',
            estado_gestion: 'sin_gestionar'
          }]
        }
      }

      if (text.includes('FROM public.cartera_tipificaciones')) {
        assert.deepEqual(values, ['15', 7])
        return { rows: [typification()] }
      }

      if (text.startsWith('UPDATE public.cartera_cuentas')) {
        assert.deepEqual(values, ['101', 'promesa_pago'])
        return { rows: [] }
      }

      if (text.includes('INSERT INTO public.cartera_gestiones')) {
        assert.equal(values[0], 7)
        assert.equal(values[1], '101')
        assert.equal(values[2], '15')
        assert.equal(values[4], 'promesa_parcial')
        return {
          rows: [{
            id: '601',
            cuenta_id: '101',
            tipificacion_codigo: 'promesa_parcial',
            estado_resultante: 'promesa_pago'
          }]
        }
      }

      if (text.includes('INSERT INTO public.cartera_historial')) {
        assert.equal(values[1], '601')
        assert.match(values[5], /promesa_parcial/)
        return { rows: [] }
      }

      throw new Error('SQL no esperado')
    }
  )

  const result = await registerPortfolioManagement({
    pool,
    usuario: executive(),
    accountId: '101',
    input: input(),
    now: NOW
  })

  assert.equal(
    result.account.estado_gestion,
    'promesa_pago'
  )
  assert.equal(pool.calls.at(-1).text, 'COMMIT')
  assert.equal(pool.client.released, true)
})

test('cierra la cuenta y finaliza la asignación cuando lo ordena el catálogo', async () => {
  const pool = transactionPool(
    async (text, values) => {
      if (text.includes('FROM public.cartera_cuentas')) {
        return {
          rows: [{
            id: '101',
            estado_gestion: 'pago_realizado',
            activa: true
          }]
        }
      }

      if (text.includes('FROM public.cartera_tipificaciones')) {
        return {
          rows: [typification({
            codigo: 'cierre_prueba',
            nombre: 'Cierre de prueba',
            estado_resultante: 'cerrado',
            requiere_promesa: false,
            cierra_cuenta: true
          })]
        }
      }

      if (text.startsWith('UPDATE public.cartera_cuentas')) {
        assert.deepEqual(values, ['101', 'cerrado'])
        assert.match(text, /activa = FALSE/)
        return { rows: [] }
      }

      if (text.startsWith('UPDATE public.cartera_asignaciones')) {
        assert.deepEqual(values, ['101'])
        assert.match(text, /finalizada_at = NOW\(\)/)
        return { rows: [] }
      }

      if (text.includes('INSERT INTO public.cartera_gestiones')) {
        return {
          rows: [{
            id: '602',
            cuenta_id: '101',
            tipificacion_codigo: 'cierre_prueba',
            estado_resultante: 'cerrado'
          }]
        }
      }

      if (text.includes('INSERT INTO public.cartera_historial')) {
        assert.equal(values[1], '602')
        assert.match(values[5], /\"activa\":false/)
        assert.match(values[5], /\"cierra_cuenta\":true/)
        return { rows: [] }
      }

      throw new Error('SQL no esperado')
    }
  )

  const result = await registerPortfolioManagement({
    pool,
    usuario: executive(),
    accountId: '101',
    input: input({
      promesa_monto: null,
      promesa_fecha: null,
      notas: 'Cierre controlado de la cuenta de prueba.'
    }),
    now: NOW
  })

  assert.equal(result.account.estado_gestion, 'cerrado')
  assert.equal(result.account.activa, false)
  assert.equal(pool.calls.at(-1).text, 'COMMIT')
})

test('rechaza tipificación ajena o inactiva y revierte', async () => {
  const pool = transactionPool(
    async text => {
      if (text.includes('FROM public.cartera_cuentas')) {
        return {
          rows: [{
            id: '101',
            estado_gestion: 'sin_gestionar'
          }]
        }
      }

      if (text.includes('FROM public.cartera_tipificaciones')) {
        return { rows: [] }
      }

      throw new Error('SQL no esperado')
    }
  )

  await assert.rejects(
    registerPortfolioManagement({
      pool,
      usuario: executive(),
      accountId: '101',
      input: input(),
      now: NOW
    }),
    error => (
      error.code === 'CARTERA_TYPIFICATION_NOT_FOUND'
      && error.status === 404
    )
  )

  assert.equal(pool.calls.at(-1).text, 'ROLLBACK')
})

test('migración 007 crea catálogo y gestión estructurada', () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      '../migrations/007_create_portfolio_management_records.sql'
    ),
    'utf8'
  )

  assert.match(sql, /006_create_integration_execution_history/)
  assert.match(sql, /CREATE TABLE public\.cartera_tipificaciones/)
  assert.match(sql, /promesa_parcial/)
  assert.match(sql, /numero_equivocado/)
  assert.match(sql, /CREATE TABLE public\.cartera_gestiones/)
  assert.match(sql, /promesa_estado/)
  assert.match(sql, /seguimiento_estado/)
  assert.match(sql, /ADD COLUMN gestion_id BIGINT/)
})
