const test = require('node:test')
const assert = require('node:assert/strict')

const {
  SNAPSHOT_FIELDS,
  persistPortfolio,
  recordFailedImport,
  validatePersistenceInput
} = require('../importers/cartera-repository')

const ORIGIN_ID = 8
const INTEGRATION_ID = 9

function portfolio(records = [
  {
    identity: {
      idCampania: 'CAMP-1',
      idCliente: 'CLIENTE-1',
      folio: 'FOLIO-1'
    },
    snapshot: {
      nombre: 'Cliente controlado',
      saldo: 1000
    }
  }
]) {
  return {
    date: '2026-07-29',
    fileName: 'Cartera_BancoAzteca_2026-07-29.xlsx',
    sha256: 'a'.repeat(64),
    records
  }
}

function assignmentStub(status = 'assigned') {
  const calls = []
  const fn = async input => {
    calls.push(input)

    return {
      status,
      asignacionId: 900 + calls.length,
      usuarioId: 20
    }
  }

  fn.calls = calls

  return fn
}

function fakePool({
  existingByHash = null,
  completedByDate = null,
  accountInsertRows = [
    {
      id: 101
    }
  ],
  snapshotRows = [
    {
      id: 201
    }
  ]
} = {}) {
  const calls = []
  let accountInsertIndex = 0
  let snapshotIndex = 0

  const client = {
    released: false,
    async query(sql, params = []) {
      const compact = String(sql)
        .replace(/\s+/g, ' ')
        .trim()

      calls.push({
        scope: 'client',
        sql: compact,
        params
      })

      if (
        compact === 'BEGIN'
        || compact === 'COMMIT'
        || compact === 'ROLLBACK'
        || compact.includes('pg_advisory_xact_lock')
      ) {
        return {
          rows: []
        }
      }

      if (
        compact.includes('archivo_sha256 = $3')
        && compact.includes('FOR UPDATE')
      ) {
        return {
          rows: existingByHash
            ? [existingByHash]
            : []
        }
      }

      if (
        compact.includes("estado = 'completada'")
        && compact.includes('fecha_cartera = $3')
      ) {
        return {
          rows: completedByDate
            ? [completedByDate]
            : []
        }
      }

      if (
        compact.startsWith(
          'INSERT INTO public.cartera_importaciones'
        )
      ) {
        return {
          rows: [
            {
              id: 11
            }
          ]
        }
      }

      if (
        compact.startsWith(
          'UPDATE public.cartera_importaciones'
        )
        && compact.includes("estado = 'procesando'")
      ) {
        return {
          rows: [
            {
              id: existingByHash?.id || 11
            }
          ]
        }
      }

      if (
        compact.startsWith(
          'UPDATE public.cartera_importaciones'
        )
        && compact.includes("estado = 'completada'")
      ) {
        return {
          rows: [
            {
              id: 11
            }
          ]
        }
      }

      if (
        compact.startsWith(
          'INSERT INTO public.cartera_cuentas'
        )
      ) {
        const row = accountInsertRows[
          accountInsertIndex++
        ]

        return {
          rows: row ? [row] : []
        }
      }

      if (
        compact.startsWith(
          'UPDATE public.cartera_cuentas'
        )
      ) {
        return {
          rows: [
            {
              id: 102
            }
          ]
        }
      }

      if (
        compact.startsWith(
          'INSERT INTO public.cartera_snapshots'
        )
      ) {
        const row = snapshotRows[snapshotIndex++]

        return {
          rows: row ? [row] : []
        }
      }

      return {
        rows: []
      }
    },
    release() {
      this.released = true
    }
  }

  const pool = {
    failureCalls: [],
    connectCalls: 0,
    async connect() {
      this.connectCalls++
      return client
    },
    async query(sql, params = []) {
      const compact = String(sql)
        .replace(/\s+/g, ' ')
        .trim()

      this.failureCalls.push({
        sql: compact,
        params
      })

      return {
        rows: []
      }
    }
  }

  return {
    calls,
    client,
    pool
  }
}

test('rechaza parámetros de persistencia incompletos', () => {
  assert.throws(
    () => validatePersistenceInput({
      pool: {},
      empresaId: 1,
      origenId: ORIGIN_ID,
      integracionId: INTEGRATION_ID,
      portfolio: portfolio()
    }),
    error => (
      error.code === 'BAZ_PERSIST_POOL_INVALID'
    )
  )
})

test('distribuye 32 campos normalizados y el origen completo', () => {
  assert.equal(SNAPSHOT_FIELDS.length, 33)
  assert.deepEqual(
    SNAPSHOT_FIELDS.at(-1),
    ['datos_origen', 'rawData']
  )
})

test('importa una cuenta nueva en una transacción', async () => {
  const context = fakePool()
  const assignFn = assignmentStub()

  const result = await persistPortfolio({
    pool: context.pool,
    empresaId: 7,
    origenId: ORIGIN_ID,
    integracionId: INTEGRATION_ID,
    portfolio: portfolio(),
    creadoPor: 3,
    assignFn
  })

  assert.deepEqual(result, {
    status: 'imported',
    importacionId: 11,
    campaigns: 1,
    totalRows: 1,
    newRecords: 1,
    updatedRecords: 0,
    assignedRecords: 1,
    keptAssignments: 0
  })
  assert.equal(context.client.released, true)
  assert.equal(
    context.calls.some(call => call.sql === 'COMMIT'),
    true
  )
  assert.equal(
    context.calls.some(call => call.sql === 'ROLLBACK'),
    false
  )
  assert.equal(context.pool.failureCalls.length, 0)

  const importInsert = context.calls.find(call => (
    call.sql.startsWith(
      'INSERT INTO public.cartera_importaciones'
    )
  ))
  const accountInsert = context.calls.find(call => (
    call.sql.startsWith(
      'INSERT INTO public.cartera_cuentas'
    )
  ))

  assert.deepEqual(importInsert.params.slice(0, 3), [
    7,
    ORIGIN_ID,
    INTEGRATION_ID
  ])
  assert.deepEqual(accountInsert.params.slice(0, 2), [
    7,
    ORIGIN_ID
  ])
  assert.match(
    accountInsert.sql,
    /empresa_id, origen_id, id_campania/
  )
})

test('actualiza una cuenta existente sin duplicarla', async () => {
  const context = fakePool({
    accountInsertRows: []
  })

  const result = await persistPortfolio({
    pool: context.pool,
    empresaId: 7,
    origenId: ORIGIN_ID,
    integracionId: INTEGRATION_ID,
    portfolio: portfolio(),
    assignFn: assignmentStub('kept')
  })

  assert.equal(result.newRecords, 0)
  assert.equal(result.updatedRecords, 1)
  assert.equal(result.assignedRecords, 0)
  assert.equal(result.keptAssignments, 1)
  assert.equal(
    context.calls.some(call => (
      call.sql.startsWith(
        'UPDATE public.cartera_cuentas'
      )
    )),
    true
  )
})

test('no repite una importación completada con el mismo SHA', async () => {
  const context = fakePool({
    existingByHash: {
      id: 55,
      estado: 'completada'
    }
  })

  const result = await persistPortfolio({
    pool: context.pool,
    empresaId: 7,
    origenId: ORIGIN_ID,
    integracionId: INTEGRATION_ID,
    portfolio: portfolio(),
    assignFn: assignmentStub()
  })

  assert.deepEqual(result, {
    status: 'already_imported',
    importacionId: 55,
    totalRows: 1
  })
  assert.equal(
    context.calls.some(call => call.sql === 'ROLLBACK'),
    true
  )
  assert.equal(
    context.calls.some(call => call.sql === 'COMMIT'),
    false
  )
})

test('rechaza otro archivo completado para la misma fecha', async () => {
  const context = fakePool({
    completedByDate: {
      id: 50,
      archivo_sha256: 'b'.repeat(64)
    }
  })

  await assert.rejects(
    () => persistPortfolio({
      pool: context.pool,
      empresaId: 7,
      origenId: ORIGIN_ID,
      integracionId: INTEGRATION_ID,
      portfolio: portfolio(),
      assignFn: assignmentStub()
    }),
    error => (
      error.code === 'BAZ_IMPORT_DATE_ALREADY_COMPLETED'
    )
  )

  assert.equal(
    context.calls.some(call => call.sql === 'ROLLBACK'),
    true
  )
  assert.equal(
    context.calls.filter(call => (
      call.sql.startsWith(
        'INSERT INTO public.cartera_importaciones'
      )
      && String(call.params[6]).startsWith('BAZ_')
    )).length,
    1
  )
})

test('hace rollback si el snapshot ya existe', async () => {
  const context = fakePool({
    snapshotRows: []
  })

  await assert.rejects(
    () => persistPortfolio({
      pool: context.pool,
      empresaId: 7,
      origenId: ORIGIN_ID,
      integracionId: INTEGRATION_ID,
      portfolio: portfolio(),
      assignFn: assignmentStub()
    }),
    error => (
      error.code === 'BAZ_SNAPSHOT_DUPLICATE'
    )
  )

  assert.equal(
    context.calls.some(call => call.sql === 'ROLLBACK'),
    true
  )
  assert.equal(
    context.calls.some(call => call.sql === 'COMMIT'),
    false
  )
  assert.equal(
    context.calls.filter(call => (
      call.sql.startsWith(
        'INSERT INTO public.cartera_importaciones'
      )
      && String(call.params[6]).startsWith('BAZ_')
    )).length,
    1
  )
})

test('cuenta campañas distintas al cerrar la importación', async () => {
  const context = fakePool({
    accountInsertRows: [
      {
        id: 101
      },
      {
        id: 102
      }
    ],
    snapshotRows: [
      {
        id: 201
      },
      {
        id: 202
      }
    ]
  })
  const records = [
    {
      identity: {
        idCampania: 'CAMP-1',
        idCliente: 'CLIENTE-1',
        folio: 'FOLIO-1'
      },
      snapshot: {}
    },
    {
      identity: {
        idCampania: 'CAMP-2',
        idCliente: 'CLIENTE-2',
        folio: 'FOLIO-2'
      },
      snapshot: {}
    }
  ]

  const result = await persistPortfolio({
    pool: context.pool,
    empresaId: 7,
    origenId: ORIGIN_ID,
    integracionId: INTEGRATION_ID,
    portfolio: portfolio(records),
    assignFn: assignmentStub()
  })

  assert.equal(result.campaigns, 2)
  assert.equal(result.totalRows, 2)
  assert.equal(result.newRecords, 2)
  assert.equal(result.assignedRecords, 2)
})

test('no guarda mensajes internos de PostgreSQL en la auditoría', async () => {
  const calls = []
  const queryTarget = {
    async query(sql, params) {
      calls.push({
        sql,
        params
      })

      return {
        rows: []
      }
    }
  }

  await recordFailedImport(
    queryTarget,
    {
      empresaId: 7,
      origenId: ORIGIN_ID,
      integracionId: INTEGRATION_ID,
      portfolio: portfolio(),
      creadoPor: null,
      error: {
        code: '23505',
        message: 'detalle interno que no debe persistirse'
      }
    }
  )

  assert.equal(
    calls[0].params[6],
    'BAZ_IMPORT_UNEXPECTED'
  )
  assert.equal(
    calls[0].params[7],
    'Error interno durante la importación'
  )
})

test('envía cada cuenta al round robin dentro de la importación', async () => {
  const context = fakePool()
  const assignFn = assignmentStub()

  await persistPortfolio({
    pool: context.pool,
    empresaId: 7,
    origenId: ORIGIN_ID,
    integracionId: INTEGRATION_ID,
    portfolio: portfolio(),
    assignFn
  })

  assert.equal(assignFn.calls.length, 1)
  assert.equal(assignFn.calls[0].client, context.client)
  assert.equal(assignFn.calls[0].empresaId, 7)
  assert.equal(assignFn.calls[0].origenId, ORIGIN_ID)
  assert.equal(assignFn.calls[0].cuentaId, 101)
  assert.equal(
    assignFn.calls[0].idCampania,
    'CAMP-1'
  )

  const commitIndex = context.calls.findIndex(call => (
    call.sql === 'COMMIT'
  ))

  assert.equal(commitIndex >= 0, true)
})

test('hace rollback si falla el round robin', async () => {
  const context = fakePool()
  const assignFn = async () => {
    const error = new Error(
      'No existen ejecutivos activos'
    )
    error.code = 'BAZ_ASSIGN_NO_EXECUTIVES'
    throw error
  }

  await assert.rejects(
    () => persistPortfolio({
      pool: context.pool,
      empresaId: 7,
      origenId: ORIGIN_ID,
      integracionId: INTEGRATION_ID,
      portfolio: portfolio(),
      assignFn
    }),
    error => (
      error.code === 'BAZ_ASSIGN_NO_EXECUTIVES'
    )
  )

  assert.equal(
    context.calls.some(call => call.sql === 'ROLLBACK'),
    true
  )
  assert.equal(
    context.calls.some(call => call.sql === 'COMMIT'),
    false
  )
})

test('rechaza resultados desconocidos del asignador', async () => {
  const context = fakePool()

  await assert.rejects(
    () => persistPortfolio({
      pool: context.pool,
      empresaId: 7,
      origenId: ORIGIN_ID,
      integracionId: INTEGRATION_ID,
      portfolio: portfolio(),
      assignFn: async () => ({
        status: 'desconocido'
      })
    }),
    error => (
      error.code === 'BAZ_ASSIGN_RESULT_INVALID'
    )
  )

  assert.equal(
    context.calls.some(call => call.sql === 'ROLLBACK'),
    true
  )
})
