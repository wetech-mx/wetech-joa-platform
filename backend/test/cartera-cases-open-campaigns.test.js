const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { ROLES } = require('../config/constants')
const {
  assignByCampaignMode
} = require('../importers/cartera-repository')
const {
  createPortfolioCase,
  normalizeVersion,
  updatePortfolioCase
} = require('../repositories/cartera-case-repository')
const {
  normalizeCampaignDistributionMode
} = require('../repositories/cartera-campaign-repository')
const {
  buildListStatement,
  buildManagementListStatement,
  buildSummaryStatement
} = require('../repositories/cartera-read-repository')

function read(relativePath) {
  return fs.readFileSync(
    path.join(__dirname, '..', relativePath),
    'utf8'
  )
}

function executive(id = 12) {
  return {
    id,
    empresa_id: 7,
    rol: ROLES.EJECUTIVO
  }
}

function transactionPool(handler) {
  const calls = []
  const client = {
    async query(text, values) {
      const sql = String(text).trim()
      calls.push({ text: sql, values })

      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
        return { rows: [] }
      }

      return handler(sql, values, calls)
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

test('migración 011 conserva campañas y crea casos auditados', () => {
  const migration = read(
    'migrations/011_create_campaign_access_modes_and_cases.sql'
  )

  assert.match(
    migration,
    /modo_distribucion[\s\S]*DEFAULT 'round_robin'/
  )
  assert.match(migration, /'manual',[\s\S]*'abierta'/)
  assert.match(migration, /CREATE TABLE public\.cartera_casos \(/)
  assert.match(
    migration,
    /CREATE TABLE public\.cartera_casos_historial \(/
  )
  assert.match(migration, /version INTEGER NOT NULL DEFAULT 1/)
  assert.match(
    migration,
    /011_create_campaign_access_modes_and_cases/
  )
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE/)
})

test('acepta solo los tres modos de distribución', () => {
  assert.equal(
    normalizeCampaignDistributionMode(' ABIERTA '),
    'abierta'
  )
  assert.equal(
    normalizeCampaignDistributionMode('manual'),
    'manual'
  )
  assert.throws(
    () => normalizeCampaignDistributionMode('todos'),
    error => (
      error.code ===
      'CARTERA_CAMPAIGN_DISTRIBUTION_MODE_INVALID'
    )
  )
})

test('campaña abierta deja la cuenta disponible sin asignarla', async () => {
  const calls = []
  const result = await assignByCampaignMode({
    client: {
      async query(text, values) {
        calls.push({ text, values })

        if (String(text).includes('cartera_campanias')) {
          return {
            rows: [{ modo_distribucion: 'abierta' }]
          }
        }

        return { rows: [] }
      }
    },
    empresaId: 7,
    origenId: '3',
    cuentaId: '101',
    idCampania: 'CALL-1',
    roundRobinFn() {
      throw new Error('No debe ejecutar round robin')
    }
  })

  assert.deepEqual(result, {
    status: 'unassigned',
    mode: 'abierta'
  })
  assert.equal(calls.length, 2)
  assert.match(String(calls[1].text), /FOR UPDATE/)
})

test('Ejecutivo ve cuentas abiertas y solo sus propias gestiones', () => {
  const scope = {
    empresaId: 7,
    userId: 12,
    isExecutive: true
  }
  const filters = {
    active: true,
    limit: 25,
    offset: 0
  }
  const list = buildListStatement({ scope, filters })
  const managements = buildManagementListStatement({
    scope,
    filters: {}
  })
  const summary = buildSummaryStatement(scope)

  assert.match(list.where, /modo_distribucion = 'abierta'/)
  assert.match(managements.where, /g\.usuario_id = \$2/)
  assert.match(summary.where, /modo_distribucion = 'abierta'/)
  assert.match(summary.from, /cartera_campanias cp/)
})

test('Ejecutivo crea caso para sí mismo con fecha del servidor', async () => {
  const pool = transactionPool(async (sql, values) => {
    if (sql.includes('FROM public.cartera_cuentas')) {
      assert.match(sql, /modo_distribucion = 'abierta'/)
      return {
        rows: [{
          id: '101',
          id_campania: 'CALL-1',
          origen_id: '3',
          activa: true
        }]
      }
    }

    if (sql.includes('FROM public.usuarios')) {
      assert.equal(values[0], 12)
      return { rows: [{ id: 12, nombre: 'Ejecutivo' }] }
    }

    if (sql.startsWith('INSERT INTO public.cartera_casos\n')) {
      assert.equal(values[5], 12)
      assert.match(sql, /clock_timestamp\(\)/)
      return {
        rows: [{ id: '501', cuenta_id: '101', version: 1 }]
      }
    }

    if (
      sql.includes('cartera_casos_historial')
      || sql.includes('cartera_historial')
    ) {
      return { rows: [] }
    }

    throw new Error(`SQL no esperado: ${sql}`)
  })

  const result = await createPortfolioCase({
    pool,
    usuario: executive(),
    input: {
      cuenta_id: '101',
      titulo: 'Aclaración de saldo',
      prioridad: 'alta',
      estado: 'nuevo',
      asignado_a: '99',
      comentarios: 'Cliente solicita revisión.'
    }
  })

  assert.equal(result.case.id, '501')
  assert.equal(pool.calls.at(-1).text, 'COMMIT')
  assert.equal(
    pool.calls.filter(call => (
      call.text.includes('INSERT INTO public.cartera_historial')
    )).length,
    1
  )
})

test('dos ediciones del mismo caso se ordenan por bloqueo y versión', async () => {
  const pool = transactionPool(async sql => {
    if (
      sql.includes('FROM public.cartera_casos')
      && sql.includes('FOR UPDATE')
    ) {
      return {
        rows: [{
          id: '501',
          cuenta_id: '101',
          titulo: 'Caso',
          prioridad: 'media',
          estado: 'nuevo',
          asignado_a: 12,
          comentarios: 'Inicial',
          solucion: null,
          version: 2
        }]
      }
    }

    throw new Error(`SQL no esperado: ${sql}`)
  })

  await assert.rejects(
    updatePortfolioCase({
      pool,
      usuario: executive(),
      caseId: '501',
      input: {
        version: 1,
        titulo: 'Cambio simultáneo',
        prioridad: 'alta',
        estado: 'en_proceso',
        comentarios: 'Cambio'
      }
    }),
    error => (
      error.code === 'CARTERA_CASE_VERSION_CONFLICT'
      && error.status === 409
    )
  )

  assert.match(
    pool.calls.find(call => call.text.includes('cartera_casos')).text,
    /FOR UPDATE/
  )
  assert.equal(pool.calls.at(-1).text, 'ROLLBACK')
})

test('las gestiones usan la hora real después de obtener el bloqueo', () => {
  const management = read(
    'repositories/cartera-management-repository.js'
  )

  assert.match(
    management,
    /INSERT INTO public\.cartera_gestiones[\s\S]*clock_timestamp\(\)/
  )
  assert.match(
    management,
    /INSERT INTO public\.cartera_historial[\s\S]*clock_timestamp\(\)/
  )
})

test('la versión concurrente debe ser un entero seguro', () => {
  assert.equal(normalizeVersion('2'), 2)
  assert.throws(
    () => normalizeVersion('999999999999999999999'),
    error => error.code === 'CARTERA_CASE_VERSION_REQUIRED'
  )
})

test('frontend integra campañas abiertas, Casos y fecha automática', () => {
  const app = read('../frontend/src/App.jsx')
  const campaigns = read('../frontend/src/CarteraCampanias.jsx')
  const cases = read('../frontend/src/CarteraCases.jsx')
  const drawer = read('../frontend/src/CarteraDrawer.jsx')

  assert.match(app, /setPantalla\('casos'\)/)
  assert.match(app, /<CarteraCases usuario=\{usuario\}/)
  assert.match(campaigns, /Abierta para todos/)
  assert.match(campaigns, /modo_distribucion/)
  assert.match(cases, /fecha automática e historial/i)
  assert.match(cases, /\/crm-api\/cartera\/casos/)
  assert.match(drawer, /Campaña abierta: todos los Ejecutivos/)
  assert.match(drawer, /item\.seccion/)
})

test('rutas de Casos quedan después de autenticación empresarial', () => {
  const routes = read('routes/cartera.routes.js')
  const protectedAt = routes.indexOf('router.use(\n  verificaToken')
  const casesAt = routes.indexOf("'/cartera/casos'")

  assert.ok(protectedAt >= 0)
  assert.ok(casesAt > protectedAt)
  assert.match(routes, /router\.post\([\s\S]*'\/cartera\/casos'/)
  assert.match(routes, /router\.patch\([\s\S]*'\/cartera\/casos\/:id'/)
})
