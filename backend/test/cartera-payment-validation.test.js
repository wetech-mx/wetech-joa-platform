'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  normalizeTypificationDefinition,
  normalizePortfolioManagement,
  registerPortfolioManagement,
  resolvePortfolioPaymentValidation,
  updatePortfolioState
} = require('../repositories/cartera-management-repository')

const { ROLES } = require('../config/constants')

function user(role = ROLES.ADMIN) {
  return {
    id: 9,
    empresa_id: 7,
    rol: role
  }
}

function transactionPool(handler) {
  const calls = []
  const client = {
    async query(text, values) {
      const normalized = String(text).trim()
      calls.push({ text: normalized, values })

      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) {
        return { rows: [] }
      }

      return handler(normalized, values, calls)
    },
    release() {}
  }

  return {
    calls,
    async connect() {
      return client
    }
  }
}

function paymentInput() {
  return {
    tipificacion_id: '21',
    canal: 'telefono',
    telefono_contactado: '5550100002',
    persona_contactada: 'Cliente ficticio',
    relacion_contacto: 'titular',
    notas: 'El cliente reporta que ya realizó el pago.',
    evidencia: 'FOLIO-PAGO-001'
  }
}

function paymentTypification() {
  return {
    id: '21',
    codigo: 'ya_pago',
    nombre: 'Ya pagó',
    prioridad: 1,
    estado_resultante: 'pago_reportado',
    requiere_promesa: false,
    requiere_seguimiento: false,
    cierra_cuenta: false,
    requiere_validacion_pago: true
  }
}

test('la regla Pago reportado exige validación y no permite cierre', () => {
  const definition = normalizeTypificationDefinition({
    nombre: 'Ya pagó',
    prioridad: 1,
    estado_resultante: 'pago_reportado',
    contacto_efectivo: true,
    requiere_promesa: false,
    requiere_seguimiento: false,
    cierra_cuenta: false,
    requiere_validacion_pago: true,
    orden: 50,
    activa: true
  })

  assert.equal(definition.requiresPaymentValidation, true)

  assert.throws(
    () => normalizeTypificationDefinition({
      nombre: 'Regla insegura',
      prioridad: 1,
      estado_resultante: 'pago_reportado',
      contacto_efectivo: true,
      requiere_promesa: false,
      requiere_seguimiento: false,
      cierra_cuenta: true,
      requiere_validacion_pago: true,
      orden: 50,
      activa: true
    }),
    error => (
      error.code === 'CARTERA_TYPIFICATION_PAYMENT_RULE_INVALID'
    )
  )
})

test('un pago reportado exige referencia de evidencia', () => {
  assert.throws(
    () => normalizePortfolioManagement(
      {
        ...paymentInput(),
        evidencia: null
      },
      paymentTypification(),
      new Date('2026-08-27T12:00:00.000Z')
    ),
    error => error.code === 'CARTERA_PAYMENT_EVIDENCE_REQUIRED'
  )
})

test('el cambio directo no puede simular pago ni cierre', async () => {
  const unusedPool = transactionPool(async () => {
    throw new Error('No debe consultar PostgreSQL')
  })

  for (const state of [
    'pago_reportado',
    'pago_realizado',
    'cerrado'
  ]) {
    await assert.rejects(
      updatePortfolioState({
        pool: unusedPool,
        usuario: user(),
        accountId: '101',
        state
      }),
      error => error.code === 'CARTERA_STATE_WORKFLOW_REQUIRED'
    )
  }

  assert.equal(unusedPool.calls.length, 0)
})

test('Ya pagó crea validación pendiente sin cerrar la cuenta', async () => {
  const pool = transactionPool(async (text, values) => {
    if (text.includes('FROM public.cartera_cuentas c')) {
      return {
        rows: [{
          id: '101',
          estado_gestion: 'seguimiento',
          activa: true
        }]
      }
    }

    if (text.includes('FROM public.cartera_tipificaciones')) {
      return { rows: [paymentTypification()] }
    }

    if (text.includes('FROM public.cartera_pago_validaciones')) {
      return { rows: [] }
    }

    if (text.startsWith('UPDATE public.cartera_cuentas')) {
      assert.deepEqual(values, ['101', 'pago_reportado'])
      assert.doesNotMatch(text, /activa = FALSE/)
      return { rows: [] }
    }

    if (text.includes('INSERT INTO public.cartera_gestiones')) {
      return {
        rows: [{
          id: '601',
          cuenta_id: '101',
          estado_resultante: 'pago_reportado'
        }]
      }
    }

    if (text.includes('INSERT INTO public.cartera_pago_validaciones')) {
      assert.deepEqual(
        values,
        [7, '601', '101', 'seguimiento', 9]
      )
      return {
        rows: [{
          id: '701',
          gestion_id: '601',
          cuenta_id: '101',
          estado: 'pendiente'
        }]
      }
    }

    if (text.includes('INSERT INTO public.cartera_historial')) {
      assert.equal(values[3], 'pago_reportado')
      assert.match(values[6], /"pago_validacion_id":"701"/)
      return { rows: [] }
    }

    throw new Error(`SQL no esperado: ${text}`)
  })

  const result = await registerPortfolioManagement({
    pool,
    usuario: user(ROLES.EJECUTIVO),
    accountId: '101',
    input: paymentInput(),
    now: new Date('2026-08-27T12:00:00.000Z')
  })

  assert.equal(result.account.estado_gestion, 'pago_reportado')
  assert.equal(result.account.activa, true)
  assert.equal(result.paymentValidation.estado, 'pendiente')
  assert.equal(
    pool.calls.some(call => (
      call.text.startsWith('UPDATE public.cartera_asignaciones')
    )),
    false
  )
})

test('impide otra gestión mientras el pago sigue pendiente', async () => {
  const pool = transactionPool(async text => {
    if (text.includes('FROM public.cartera_cuentas c')) {
      return {
        rows: [{
          id: '101',
          estado_gestion: 'pago_reportado',
          activa: true
        }]
      }
    }

    if (text.includes('FROM public.cartera_tipificaciones')) {
      return { rows: [paymentTypification()] }
    }

    if (text.includes('FROM public.cartera_pago_validaciones')) {
      return { rows: [{ id: '701' }] }
    }

    throw new Error(`SQL no esperado: ${text}`)
  })

  await assert.rejects(
    registerPortfolioManagement({
      pool,
      usuario: user(ROLES.EJECUTIVO),
      accountId: '101',
      input: paymentInput()
    }),
    error => (
      error.code === 'CARTERA_PAYMENT_VALIDATION_PENDING'
      && error.status === 409
    )
  )

  assert.equal(pool.calls.at(-1).text, 'ROLLBACK')
})

test('administrador aprueba, cierra y finaliza la asignación', async () => {
  const pool = transactionPool(async (text, values) => {
    if (text.includes('FROM public.cartera_pago_validaciones pv')) {
      return {
        rows: [{
          id: '701',
          gestion_id: '601',
          cuenta_id: '101',
          estado: 'pendiente',
          estado_cuenta_anterior: 'seguimiento',
          estado_gestion: 'pago_reportado',
          activa: true
        }]
      }
    }

    if (text.startsWith('UPDATE public.cartera_pago_validaciones')) {
      assert.equal(values[2], 'aprobado')
      return { rows: [{ id: '701', estado: 'aprobado' }] }
    }

    if (text.startsWith('UPDATE public.cartera_cuentas')) {
      assert.deepEqual(values, ['101', 'pago_realizado', false])
      return { rows: [] }
    }

    if (text.startsWith('UPDATE public.cartera_asignaciones')) {
      assert.deepEqual(values, ['101'])
      return { rows: [] }
    }

    if (text.includes('INSERT INTO public.cartera_historial')) {
      assert.equal(values[3], 'pago_validado')
      return { rows: [{ id: '801' }] }
    }

    throw new Error(`SQL no esperado: ${text}`)
  })

  const result = await resolvePortfolioPaymentValidation({
    pool,
    usuario: user(),
    validationId: '701',
    decision: 'aprobar',
    notes: 'Pago conciliado contra el comprobante.'
  })

  assert.equal(result.account.estado_gestion, 'pago_realizado')
  assert.equal(result.account.activa, false)
  assert.equal(result.historyId, '801')
})

test('administrador rechaza y restaura la cuenta activa', async () => {
  const pool = transactionPool(async (text, values) => {
    if (text.includes('FROM public.cartera_pago_validaciones pv')) {
      return {
        rows: [{
          id: '701',
          gestion_id: '601',
          cuenta_id: '101',
          estado: 'pendiente',
          estado_cuenta_anterior: 'promesa_pago',
          estado_gestion: 'pago_reportado',
          activa: true
        }]
      }
    }

    if (text.startsWith('UPDATE public.cartera_pago_validaciones')) {
      assert.equal(values[2], 'rechazado')
      return { rows: [{ id: '701', estado: 'rechazado' }] }
    }

    if (text.startsWith('UPDATE public.cartera_cuentas')) {
      assert.deepEqual(values, ['101', 'promesa_pago', true])
      return { rows: [] }
    }

    if (text.includes('INSERT INTO public.cartera_historial')) {
      assert.equal(values[3], 'pago_rechazado')
      return { rows: [{ id: '802' }] }
    }

    if (text.startsWith('UPDATE public.cartera_asignaciones')) {
      throw new Error('Un rechazo no debe finalizar la asignación')
    }

    throw new Error(`SQL no esperado: ${text}`)
  })

  const result = await resolvePortfolioPaymentValidation({
    pool,
    usuario: user(),
    validationId: '701',
    decision: 'rechazar',
    notes: 'El comprobante no coincide con la cuenta.'
  })

  assert.equal(result.account.estado_gestion, 'promesa_pago')
  assert.equal(result.account.activa, true)
})

test('Ejecutivo no puede resolver pagos y el rechazo exige motivo', async () => {
  const unusedPool = transactionPool(async () => {
    throw new Error('No debe consultar PostgreSQL')
  })

  await assert.rejects(
    resolvePortfolioPaymentValidation({
      pool: unusedPool,
      usuario: user(ROLES.EJECUTIVO),
      validationId: '701',
      decision: 'aprobar'
    }),
    error => error.status === 403
  )

  await assert.rejects(
    resolvePortfolioPaymentValidation({
      pool: unusedPool,
      usuario: user(),
      validationId: '701',
      decision: 'rechazar',
      notes: ''
    }),
    error => (
      error.code === 'CARTERA_PAYMENT_REJECTION_NOTES_REQUIRED'
    )
  )
})

test('migración 008 conserva históricos y crea flujo de revisión', () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      '../migrations/008_create_payment_validation_workflow.sql'
    ),
    'utf8'
  )

  assert.match(sql, /007_create_portfolio_management_records/)
  assert.match(sql, /'pago_reportado'/)
  assert.match(sql, /requiere_validacion_pago BOOLEAN/)
  assert.match(sql, /CREATE TABLE public\.cartera_pago_validaciones/)
  assert.match(sql, /estado IN \('pendiente', 'aprobado', 'rechazado'\)/)
  assert.match(sql, /codigo IN \('ya_pago', 'ya_pago_recurrencia'\)/)
  assert.doesNotMatch(sql, /UPDATE public\.cartera_gestiones/)
})

test('rutas de validación y cambio directo exigen administrador', () => {
  const routes = fs.readFileSync(
    path.join(__dirname, '../routes/cartera.routes.js'),
    'utf8'
  )

  assert.match(
    routes,
    /'\/cartera\/pagos\/:id\/validacion',[\s\S]*?requiereAdmin,[\s\S]*?resolverValidacionPagoCartera/
  )
  assert.match(
    routes,
    /'\/cartera\/:id\/estado',[\s\S]*?requiereAdmin,[\s\S]*?actualizarEstadoCartera/
  )
})
