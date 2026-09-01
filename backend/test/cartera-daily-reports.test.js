const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  getDailyCutReport,
  normalizeReportDate,
  summarizeCut
} = require('../repositories/cartera-report-repository')

const {
  normalizeCampaignName,
  updatePortfolioCampaign
} = require('../repositories/cartera-campaign-repository')

const {
  reportWorkbook,
  safeSpreadsheetText
} = require('../services/cartera-report-service')

const {
  ROLES
} = require('../config/constants')

function read(relativePath) {
  return fs.readFileSync(
    path.join(__dirname, '..', relativePath),
    'utf8'
  )
}

test('migración 009 separa campaña, corte vigente e historial', () => {
  const migration = read(
    'migrations/009_create_campaign_catalog_and_daily_cut.sql'
  )

  assert.match(
    migration,
    /CREATE TABLE public\.cartera_campanias/
  )
  assert.match(
    migration,
    /ADD COLUMN en_corte_actual BOOLEAN NOT NULL DEFAULT TRUE/
  )
  assert.match(
    migration,
    /ADD COLUMN registros_fuera_corte INTEGER NOT NULL DEFAULT 0/
  )
  assert.match(
    migration,
    /009_create_campaign_catalog_and_daily_cut/
  )
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM/)
})

test('el importador concilia sin cerrar expedientes', () => {
  const repository = read('importers/cartera-repository.js')

  assert.match(repository, /upsertCampaign/)
  assert.match(repository, /en_corte_actual = FALSE/)
  assert.match(repository, /NOT EXISTS/)
  assert.match(repository, /registros_fuera_corte/)
  assert.doesNotMatch(
    repository,
    /SET\s+activa = FALSE[\s\S]*registros_fuera_corte/
  )
})

test('valida el nombre operativo de campaña', () => {
  assert.equal(
    normalizeCampaignName('  Extrajudicial septiembre  '),
    'Extrajudicial septiembre'
  )
  assert.throws(
    () => normalizeCampaignName(''),
    error => error.code === 'CARTERA_CAMPAIGN_NAME_INVALID'
  )
})

test('un Ejecutivo no puede editar campañas', async () => {
  await assert.rejects(
    () => updatePortfolioCampaign({
      pool: {
        async query() {
          throw new Error('No debe consultar PostgreSQL')
        }
      },
      usuario: {
        id: 5,
        empresa_id: 7,
        rol: ROLES.EJECUTIVO
      },
      campaignId: '1',
      input: {
        nombre: 'Prueba',
        activa: true
      }
    }),
    error => (
      error.code === 'CARTERA_CAMPAIGN_FORBIDDEN'
      && error.status === 403
    )
  )
})

test('resume el corte por Ejecutivo y en general', () => {
  const result = summarizeCut(
    [
      {
        ejecutivo_id: 10,
        ejecutivo_nombre: 'Joana',
        id_campania: 'CAMP-1',
        estado_gestion: 'sin_gestionar',
        saldo: '100.50',
        pago_requerido: '25.00'
      },
      {
        ejecutivo_id: 10,
        ejecutivo_nombre: 'Joana',
        id_campania: 'CAMP-1',
        estado_gestion: 'seguimiento',
        saldo: '200.00',
        pago_requerido: '50.00'
      },
      {
        ejecutivo_id: 11,
        ejecutivo_nombre: 'Juan',
        id_campania: 'CAMP-2',
        estado_gestion: 'cerrado',
        saldo: '300.00',
        pago_requerido: '0'
      }
    ],
    [
      {
        ejecutivo_id: 10,
        total: '2',
        cuentas_gestionadas: '1'
      },
      {
        ejecutivo_id: 11,
        total: '1',
        cuentas_gestionadas: '1'
      }
    ]
  )

  assert.equal(result.totals.accounts, 3)
  assert.equal(result.totals.campaigns, 2)
  assert.equal(result.totals.managementsToday, 3)
  assert.equal(result.totals.managedAccounts, 2)
  assert.equal(result.totals.unworked, 1)
  assert.equal(result.totals.balance, 600.5)
  assert.equal(result.executives.length, 2)
})

test('el reporte de Ejecutivo fuerza el alcance de su sesión', async () => {
  const calls = []
  const pool = {
    async query(text, values) {
      calls.push({ text, values })

      if (text.includes('i.id AS importacion_id')) {
        return {
          rows: [
            {
              ejecutivo_id: 12,
              ejecutivo_nombre: 'Ejecutivo prueba',
              id_campania: 'CAMP-1',
              estado_gestion: 'sin_gestionar',
              saldo: '10',
              pago_requerido: '5'
            }
          ]
        }
      }

      return { rows: [] }
    }
  }

  const report = await getDailyCutReport({
    pool,
    usuario: {
      id: 12,
      empresa_id: 7,
      rol: ROLES.EJECUTIVO
    },
    query: {
      fecha: '2026-09-01',
      ejecutivo: '99'
    }
  })

  assert.equal(report.scope, 'ejecutivo')
  assert.equal(report.filters.executiveId, '12')
  assert.ok(calls[0].values.includes(12))
  assert.ok(!calls[0].values.includes('99'))
})

test('rechaza una fecha imposible en reportes', () => {
  assert.throws(
    () => normalizeReportDate('2026-02-29'),
    error => error.code === 'CARTERA_REPORT_DATE_INVALID'
  )
})

test('el Excel neutraliza fórmulas y contiene dos hojas', () => {
  assert.equal(safeSpreadsheetText('=2+2'), "'=2+2")

  const workbook = reportWorkbook({
    date: '2026-09-01',
    totals: {
      accounts: 1,
      managedAccounts: 0,
      unworked: 1,
      closed: 0,
      managementsToday: 0,
      balance: 100,
      requiredPayment: 20
    },
    executives: [
      {
        executive: 'Joana',
        accounts: 1,
        managedAccounts: 0,
        unworked: 1,
        closed: 0,
        managementsToday: 0,
        balance: 100,
        requiredPayment: 20
      }
    ],
    details: [
      {
        origen: 'Banco Azteca',
        campania: '=RIESGO',
        id_campania: 'CAMP-1',
        cliente: 'Cliente prueba',
        id_cliente: '1',
        folio: 'F-1',
        saldo: '100',
        pago_requerido: '20',
        estado_gestion: 'sin_gestionar',
        ejecutivo_nombre: 'Joana'
      }
    ]
  })

  assert.deepEqual(workbook.SheetNames, [
    'Resumen',
    'Detalle del corte'
  ])
})

test('frontend publica campañas y reportes según el rol', () => {
  const app = fs.readFileSync(
    path.join(__dirname, '../../frontend/src/App.jsx'),
    'utf8'
  )
  const campaigns = fs.readFileSync(
    path.join(
      __dirname,
      '../../frontend/src/CarteraCampanias.jsx'
    ),
    'utf8'
  )
  const reports = fs.readFileSync(
    path.join(
      __dirname,
      '../../frontend/src/CarteraReportes.jsx'
    ),
    'utf8'
  )

  assert.match(app, /setPantalla\('campanias'\)/)
  assert.match(app, /setPantalla\('reportes'\)/)
  assert.match(app, /<CarteraReportes usuario=\{usuario\}/)
  assert.match(campaigns, /\/crm-api\/cartera\/campanias/)
  assert.match(reports, /\/cartera\/reportes\/corte\.xlsx/)
  assert.match(reports, /Reporte general/)
})

test('rutas protegen campañas y reportes dentro de la sesión', () => {
  const routes = read('routes/cartera.routes.js')

  assert.match(
    routes,
    /router\.use\([\s\S]*verificaToken,[\s\S]*requiereEmpresa/
  )
  assert.match(
    routes,
    /'\/cartera\/campanias',[\s\S]*requiereAdmin,[\s\S]*obtenerCampaniasCartera/
  )
  assert.match(routes, /'\/cartera\/reportes\/corte'/)
  assert.match(routes, /'\/cartera\/reportes\/corte\.xlsx'/)
})

test('documenta la reutilización del temporizador existente', () => {
  const guide = fs.readFileSync(
    path.join(
      __dirname,
      '../../docs/CORTE-DIARIO-Y-REPORTES.md'
    ),
    'utf8'
  )

  assert.match(guide, /banco-azteca-cartera\.timer/)
  assert.match(guide, /no deben duplicarse con otro timer/)
  assert.doesNotMatch(guide, /enable --now crm-cartera-daily/)
})
