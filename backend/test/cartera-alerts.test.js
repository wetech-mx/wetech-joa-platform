'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  buildPortfolioAlertStatement,
  getPortfolioAlerts,
  totalAlerts
} = require('../repositories/cartera-alerts-repository')

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

function source(relativePath) {
  return fs.readFileSync(
    path.join(__dirname, '../..', relativePath),
    'utf8'
  )
}

test('el alcance Ejecutivo queda parametrizado por la sesión', () => {
  const statement = buildPortfolioAlertStatement({
    scope: {
      empresaId: 7,
      isExecutive: true,
      userId: 12
    }
  })

  assert.deepEqual(
    statement.values,
    [7, ROLES.EJECUTIVO, 12]
  )
  assert.match(statement.ctes, /u\.id = \$3/)
  assert.match(statement.ctes, /c\.empresa_id = \$1/)
  assert.match(statement.ctes, /a\.activa = TRUE/)
  assert.match(statement.ctes, /latest_promise_event/)
  assert.match(statement.ctes, /p\.promesa_estado = 'pendiente'/)
  assert.match(statement.ctes, /America\/Mexico_City/)
})

test('el origen se agrega como parámetro y no como SQL', () => {
  const statement = buildPortfolioAlertStatement({
    scope: {
      empresaId: 7,
      isExecutive: false,
      userId: null
    },
    originId: '9007199254740993'
  })

  assert.deepEqual(
    statement.values,
    [
      7,
      ROLES.EJECUTIVO,
      '9007199254740993'
    ]
  )
  assert.match(statement.ctes, /c\.origen_id = \$3/)
  assert.match(
    statement.ctes,
    /history_account\.origen_id = \$3/
  )
  assert.doesNotMatch(
    statement.ctes,
    /9007199254740993/
  )
})

test('la última actividad conserva gestiones de cuentas cerradas', () => {
  const statement = buildPortfolioAlertStatement({
    scope: {
      empresaId: 7,
      userId: 2,
      isExecutive: false
    }
  })
  const activityBlock = statement.ctes
    .split('executive_activity AS (')[1]
    .split('executive_stats AS (')[0]

  assert.match(
    statement.ctes,
    /historical_activity AS \([\s\S]*FROM public\.cartera_gestiones g/
  )
  assert.match(
    statement.ctes,
    /INNER JOIN public\.cartera_cuentas history_account/
  )
  assert.match(
    statement.ctes,
    /MAX\(h\.creada_at\) AS last_activity_at/
  )
  assert.doesNotMatch(
    activityBlock,
    /FROM assigned_accounts b|GROUP BY b\.usuario_id/
  )
})

test('un Ejecutivo recibe únicamente su resumen y pendientes', async () => {
  const pool = mockPool([
    {
      rows: [
        {
          ejecutivo_id: 12,
          ejecutivo_nombre: 'Ejecutivo controlado',
          asignadas: '20',
          sin_gestionar: '10',
          gestiones_hoy: '3',
          nuevas_asignaciones: '2',
          promesas_vencidas: '1',
          promesas_hoy: '1',
          seguimientos_vencidos: '2',
          seguimientos_hoy: '4',
          ultima_actividad_at: '2026-08-25T15:00:00.000Z'
        }
      ]
    },
    {
      rows: [
        {
          alerta_tipo: 'promesa_vencida',
          severidad: 'urgente',
          vence_at: '2026-08-24T00:00:00.000Z',
          gestion_id: '80',
          cuenta_id: '100',
          cliente_nombre: 'Cliente controlado',
          id_cliente: 'CLIENTE-100',
          folio: 'FOLIO-100',
          id_campania: 'CAMP-1',
          ejecutivo_id: 12,
          ejecutivo_nombre: 'Ejecutivo controlado',
          promesa_monto: '500.00',
          telefono: '5550100001'
        }
      ]
    }
  ])

  const result = await getPortfolioAlerts({
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

  assert.equal(result.scope, 'ejecutivo')
  assert.equal(result.executives.length, 1)
  assert.equal(result.executives[0].id, '12')
  assert.equal(result.totals.assigned, 20)
  assert.equal(result.totals.promisesOverdue, 1)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].accountId, '100')
  assert.equal(result.items[0].amount, '500.00')
  assert.ok(
    pool.calls.every(call => (
      !call.values.includes(99)
      && !call.values.includes('99')
    ))
  )
  assert.match(pool.calls[0].text, /u\.id = \$3/)
})

test('el supervisor recibe el concentrado de Ejecutivos activos', async () => {
  const pool = mockPool([
    {
      rows: [
        {
          ejecutivo_id: 20,
          ejecutivo_nombre: 'Ana',
          asignadas: '5',
          sin_gestionar: '3',
          gestiones_hoy: '2',
          nuevas_asignaciones: '1',
          promesas_vencidas: '1',
          promesas_hoy: '0',
          seguimientos_vencidos: '0',
          seguimientos_hoy: '1',
          ultima_actividad_at: null
        },
        {
          ejecutivo_id: 21,
          ejecutivo_nombre: 'Luis',
          asignadas: '7',
          sin_gestionar: '4',
          gestiones_hoy: '1',
          nuevas_asignaciones: '0',
          promesas_vencidas: '0',
          promesas_hoy: '1',
          seguimientos_vencidos: '2',
          seguimientos_hoy: '0',
          ultima_actividad_at: null
        }
      ]
    },
    {
      rows: []
    }
  ])

  const result = await getPortfolioAlerts({
    pool,
    usuario: {
      id: 2,
      empresa_id: 7,
      rol: ROLES.ADMIN
    }
  })

  assert.equal(result.scope, 'empresa')
  assert.equal(result.executives.length, 2)
  assert.equal(result.totals.assigned, 12)
  assert.equal(result.totals.unmanaged, 7)
  assert.equal(result.totals.followupsOverdue, 2)
  assert.equal(result.totals.followupsToday, 1)
  assert.doesNotMatch(pool.calls[0].text, /u\.id = \$3/)
})

test('suma el resumen sin aceptar contadores inválidos', () => {
  const totals = totalAlerts([
    {
      assigned: 4,
      unmanaged: 3,
      managedToday: 2,
      newAssignments: 1,
      promisesOverdue: 1,
      promisesToday: 2,
      followupsOverdue: 3,
      followupsToday: 4
    },
    {
      assigned: 6,
      unmanaged: 5,
      managedToday: 4,
      newAssignments: 3,
      promisesOverdue: 2,
      promisesToday: 1,
      followupsOverdue: 0,
      followupsToday: 2
    }
  ])

  assert.deepEqual(totals, {
    assigned: 10,
    unmanaged: 8,
    managedToday: 6,
    newAssignments: 4,
    promisesOverdue: 3,
    promisesToday: 3,
    followupsOverdue: 3,
    followupsToday: 6
  })
})

test('la API de alertas permanece dentro de rutas protegidas', () => {
  const routes = source('backend/routes/cartera.routes.js')

  assert.match(
    routes,
    /router\.use\(\s*verificaToken,\s*requiereEmpresa\s*\)/
  )
  assert.match(
    routes,
    /'\/cartera\/alertas',\s*obtenerAlertasCartera/
  )
  assert.doesNotMatch(
    routes,
    /'\/cartera\/alertas',\s*requiereAdmin/
  )
})

test('el Dashboard muestra resumen por rol y abre la cuenta', () => {
  const dashboard = source(
    'frontend/src/CarteraAlerts.jsx'
  )
  const app = source('frontend/src/App.jsx')
  const portfolio = source('frontend/src/Cartera.jsx')

  assert.match(
    dashboard,
    /\/crm-api\/cartera\/alertas/
  )
  assert.match(dashboard, /Mi resumen de pendientes/)
  assert.match(dashboard, /Supervisión por ejecutivo/)
  assert.match(dashboard, /Promesas vencidas/)
  assert.match(dashboard, /Seguimientos vencidos/)
  assert.match(
    dashboard,
    /onOpenAccount\(item\.accountId\)/
  )
  assert.match(app, /openPortfolioAccount/)
  assert.match(app, /initialAccountId=\{carteraAccountId\}/)
  assert.match(portfolio, /initialAccountId \|\| null/)
})
