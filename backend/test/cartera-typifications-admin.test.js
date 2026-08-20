const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  createPortfolioTypification,
  listPortfolioTypificationsAdmin,
  normalizeTypificationDefinition,
  updatePortfolioTypification
} = require(
  '../repositories/cartera-management-repository'
)

const {
  ROLES
} = require('../config/constants')

function administrator() {
  return {
    id: 3,
    empresa_id: 7,
    rol: ROLES.ADMIN
  }
}

function executive() {
  return {
    id: 8,
    empresa_id: 7,
    rol: ROLES.EJECUTIVO
  }
}

function input(overrides = {}) {
  return {
    codigo: 'seguimiento_especial',
    nombre: 'Seguimiento especial',
    prioridad: 3,
    estado_resultante: 'seguimiento',
    contacto_efectivo: true,
    requiere_promesa: false,
    requiere_seguimiento: true,
    cierra_cuenta: false,
    orden: 75,
    activa: true,
    ...overrides
  }
}

test('normaliza una definición administrativa completa', () => {
  const result = normalizeTypificationDefinition(
    input({ codigo: 'SEGUIMIENTO_ESPECIAL' }),
    { includeCode: true }
  )

  assert.equal(result.code, 'seguimiento_especial')
  assert.equal(result.priority, 3)
  assert.equal(result.requiresFollowUp, true)
  assert.equal(result.active, true)
})

test('rechaza cierre de cuenta con seguimiento obligatorio', () => {
  assert.throws(
    () => normalizeTypificationDefinition(
      input({ cierra_cuenta: true })
    ),
    error => error.code === 'CARTERA_TYPIFICATION_RULE_INVALID'
  )
})

test('lista activas e inactivas únicamente dentro de empresa', async () => {
  const calls = []
  const pool = {
    async query(text, values) {
      calls.push({ text, values })
      return { rows: [] }
    }
  }

  await listPortfolioTypificationsAdmin({
    pool,
    usuario: administrator()
  })

  assert.deepEqual(calls[0].values, [7])
  assert.match(calls[0].text, /empresa_id = \$1/)
  assert.doesNotMatch(calls[0].text, /activa = TRUE/)
})

test('impide administración del catálogo a un Ejecutivo', async () => {
  let queried = false
  const pool = {
    async query() {
      queried = true
      return { rows: [] }
    }
  }

  await assert.rejects(
    listPortfolioTypificationsAdmin({
      pool,
      usuario: executive()
    }),
    error => (
      error.code === 'CARTERA_TYPIFICATION_ADMIN_REQUIRED'
      && error.status === 403
    )
  )

  assert.equal(queried, false)
})

test('crea tipificación forzando empresa desde la sesión', async () => {
  const calls = []
  const pool = {
    async query(text, values) {
      calls.push({ text, values })
      return {
        rows: [{
          id: '31',
          codigo: values[1],
          nombre: values[2],
          activa: values[10]
        }]
      }
    }
  }

  const result = await createPortfolioTypification({
    pool,
    usuario: administrator(),
    input: input({ empresa_id: 999 })
  })

  assert.equal(result.typification.id, '31')
  assert.equal(calls[0].values[0], 7)
  assert.equal(calls[0].values[1], 'seguimiento_especial')
  assert.doesNotMatch(calls[0].text, /empresa_id = \$12/)
})

test('actualiza sin permitir cambiar código ni empresa', async () => {
  const calls = []
  const pool = {
    async query(text, values) {
      calls.push({ text, values })
      return {
        rows: [{
          id: values[0],
          codigo: 'codigo_inmutable',
          nombre: values[2]
        }]
      }
    }
  }

  await updatePortfolioTypification({
    pool,
    usuario: administrator(),
    typificationId: '31',
    input: input({
      codigo: 'codigo_alterado',
      empresa_id: 999
    })
  })

  assert.deepEqual(calls[0].values.slice(0, 3), [
    '31',
    7,
    'Seguimiento especial'
  ])
  assert.doesNotMatch(calls[0].text, /codigo =/)
})

test('rutas administrativas exigen requiereAdmin', () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      '../routes/cartera.routes.js'
    ),
    'utf8'
  )

  assert.match(
    source,
    /'\/cartera\/tipificaciones\/administracion',[\s\S]*?requiereAdmin,[\s\S]*?obtenerTipificacionesAdministracion/
  )
  assert.match(
    source,
    /router\.post\([\s\S]*?'\/cartera\/tipificaciones',[\s\S]*?requiereAdmin,[\s\S]*?crearTipificacionCartera/
  )
  assert.match(
    source,
    /router\.patch\([\s\S]*?'\/cartera\/tipificaciones\/:id',[\s\S]*?requiereAdmin,[\s\S]*?actualizarTipificacionCartera/
  )
})
