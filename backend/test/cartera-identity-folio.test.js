const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  transformPortfolioRow,
  transformPortfolioRows
} = require('../importers/cartera-excel')
const {
  upsertAccount
} = require('../importers/cartera-repository')

function controlledRow(overrides = {}) {
  return {
    IdCampaña: 'CAMP-1',
    IdCliente: 'CLIENTE-COMPARTIDO',
    Folio: 'FOLIO-1',
    SemanasAtraso: 0,
    DiasAtraso: 0,
    ...overrides
  }
}

test(
  'usa campaña cliente y folio como identidad',
  () => {
    const records = transformPortfolioRows([
      controlledRow({
        Folio: 'FOLIO-1'
      }),
      controlledRow({
        Folio: 'FOLIO-2'
      })
    ])

    assert.equal(records.length, 2)
    assert.notEqual(
      records[0].identity.key,
      records[1].identity.key
    )
    assert.equal(
      records[0].identity.folio,
      'FOLIO-1'
    )
  }
)

test(
  'rechaza la identidad triple duplicada',
  () => {
    assert.throws(
      () => transformPortfolioRows([
        controlledRow(),
        controlledRow()
      ]),
      error => (
        error.code
          === 'BAZ_IMPORT_DUPLICATE_IDENTITY'
      )
    )
  }
)

test('requiere folio en cada cuenta', () => {
  assert.throws(
    () => transformPortfolioRow(
      controlledRow({
        Folio: ''
      }),
      8
    ),
    error => (
      error.code
        === 'BAZ_IMPORT_REQUIRED_ID_MISSING'
      && error.details.field === 'Folio'
      && error.details.rowNumber === 8
    )
  )
})

test(
  'conserva atrasos enteros negativos',
  () => {
    const record = transformPortfolioRow(
      controlledRow({
        SemanasAtraso: -12,
        DiasAtraso: -84
      })
    )

    assert.equal(
      record.snapshot.semanasAtraso,
      -12
    )
    assert.equal(
      record.snapshot.diasAtraso,
      -84
    )
  }
)

test(
  'inserta cuentas usando folio en el conflicto',
  async () => {
    const calls = []
    const client = {
      async query(sql, values) {
        calls.push({
          sql,
          values
        })

        return {
          rows: [
            {
              id: 10
            }
          ]
        }
      }
    }

    const result = await upsertAccount(
      client,
      {
        empresaId: 1,
        importacionId: 20,
        date: '2026-04-21',
        identity: {
          idCampania: 'CAMP-1',
          idCliente: 'CLIENTE-1',
          folio: 'FOLIO-1'
        }
      }
    )

    assert.equal(result.isNew, true)
    assert.match(
      calls[0].sql,
      /id_cliente,\s+folio,/s
    )
    assert.match(
      calls[0].sql,
      /id_cliente,\s+folio\s+\)/s
    )
    assert.deepEqual(
      calls[0].values,
      [
        1,
        'CAMP-1',
        'CLIENTE-1',
        'FOLIO-1',
        '2026-04-21',
        20
      ]
    )
  }
)

test(
  'actualiza únicamente la cuenta del mismo folio',
  async () => {
    const calls = []
    const client = {
      async query(sql, values) {
        calls.push({
          sql,
          values
        })

        if (calls.length === 1) {
          return {
            rows: []
          }
        }

        return {
          rows: [
            {
              id: 10
            }
          ]
        }
      }
    }

    const result = await upsertAccount(
      client,
      {
        empresaId: 1,
        importacionId: 20,
        date: '2026-04-21',
        identity: {
          idCampania: 'CAMP-1',
          idCliente: 'CLIENTE-1',
          folio: 'FOLIO-1'
        }
      }
    )

    assert.equal(result.isNew, false)
    assert.match(
      calls[1].sql,
      /AND folio = \$4/
    )
    assert.deepEqual(
      calls[1].values,
      calls[0].values
    )
  }
)

test('define la migración 002 segura', () => {
  const migrationPath = path.join(
    __dirname,
    '../migrations/002_add_folio_account_identity.sql'
  )
  const sql = fs.readFileSync(
    migrationPath,
    'utf8'
  )

  assert.match(
    sql,
    /ADD COLUMN folio VARCHAR\(255\) NOT NULL/
  )
  assert.match(
    sql,
    /UNIQUE \(\s*empresa_id,\s*id_campania,\s*id_cliente,\s*folio\s*\)/s
  )
  assert.match(
    sql,
    /requiere cartera_cuentas vacía/
  )
})
