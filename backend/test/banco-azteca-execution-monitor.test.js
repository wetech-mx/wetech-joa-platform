'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  classifyExportResult,
  classifyImportResult,
  classifyOperationError,
  controlledErrorCode,
  monitorBancoAztecaExecution,
  parseCompanyId,
  resolveBancoAztecaIntegrationContext
} = require(
  '../integrations/banco-azteca/execution-monitor'
)

test('resuelve el conector activo dentro de su empresa', async () => {
  const calls = []
  const result = await resolveBancoAztecaIntegrationContext(
    {
      async query(sql, params) {
        calls.push({
          sql: String(sql).replace(/\s+/g, ' ').trim(),
          params
        })

        return {
          rows: [
            {
              origen_id: '10',
              integracion_id: '20'
            }
          ]
        }
      }
    },
    '1'
  )

  assert.deepEqual(result, {
    origenId: '10',
    integracionId: '20'
  })
  assert.deepEqual(
    calls[0].params,
    [1, 'banco_azteca', 'banco_azteca_api']
  )
  assert.match(calls[0].sql, /origen\.empresa_id = \$1/)
  assert.match(calls[0].sql, /integracion\.activo = TRUE/)
})

test('rechaza empresa inválida sin consultar PostgreSQL', () => {
  assert.throws(
    () => parseCompanyId('0'),
    error => (
      error.code === 'BAZ_EXECUTION_COMPANY_INVALID'
    )
  )
})

test('clasifica extracción generada con métricas seguras', () => {
  assert.deepEqual(
    classifyExportResult({
      status: 'generated',
      campaigns: 2,
      clients: 200,
      bytes: 87595,
      filePath: '/ruta-que-no-debe-guardarse'
    }),
    {
      status: 'completada',
      metrics: {
        campanias: 2,
        registros_recibidos: 200,
        bytes: 87595
      }
    }
  )
})

test('clasifica archivo previo como ejecución omitida', () => {
  assert.deepEqual(
    classifyExportResult({
      status: 'already_exists'
    }),
    {
      status: 'omitida',
      metrics: {
        archivo_existente: true
      }
    }
  )
})

test('clasifica importación y omite campos no autorizados', () => {
  assert.deepEqual(
    classifyImportResult({
      status: 'imported',
      campaigns: 2,
      totalRows: 200,
      newRecords: 150,
      updatedRecords: 50,
      assignedRecords: 150,
      keptAssignments: 50,
      sha256: 'valor-que-no-debe-guardarse'
    }),
    {
      status: 'completada',
      metrics: {
        campanias: 2,
        registros_recibidos: 200,
        registros_procesados: 200,
        registros_nuevos: 150,
        registros_actualizados: 50,
        registros_asignados: 150,
        asignaciones_conservadas: 50
      }
    }
  )
})

test('clasifica importación repetida como omitida', () => {
  assert.deepEqual(
    classifyImportResult({
      status: 'already_imported',
      totalRows: 200
    }),
    {
      status: 'omitida',
      metrics: {
        registros_recibidos: 200,
        registros_procesados: 200
      }
    }
  )
})

test('convierte respuesta vacía en sin datos', () => {
  assert.deepEqual(
    classifyOperationError(
      { code: 'BAZ_EMPTY_RESPONSE' },
      'BAZ_EXPORT_UNEXPECTED'
    ),
    {
      status: 'sin_datos',
      metrics: {},
      errorCode: 'BAZ_EMPTY_RESPONSE'
    }
  )
})

test('no convierte mensajes o valores arbitrarios en códigos', () => {
  assert.equal(
    controlledErrorCode(
      { code: 'token=valor' },
      'BAZ_EXPORT_UNEXPECTED'
    ),
    'BAZ_EXPORT_UNEXPECTED'
  )
})

test('registra inicio y finalización de una extracción', async () => {
  const calls = []
  const result = await monitorBancoAztecaExecution({
    pool: { marker: 'pool' },
    empresaId: 1,
    stage: 'extraccion',
    fallbackErrorCode: 'BAZ_EXPORT_UNEXPECTED',
    classifyResult: classifyExportResult,
    resolveContextFn: async () => ({
      origenId: '10',
      integracionId: '20'
    }),
    startFn: async input => {
      calls.push(['start', input])
      return { id: '30' }
    },
    finishFn: async input => {
      calls.push(['finish', input])
    },
    operation: async context => {
      calls.push(['operation', context])
      return {
        status: 'generated',
        campaigns: 2,
        clients: 200,
        bytes: 87595
      }
    }
  })

  assert.equal(result.status, 'generated')
  assert.equal(calls[0][0], 'start')
  assert.equal(calls[0][1].trigger, 'programada')
  assert.equal(calls[1][0], 'operation')
  assert.deepEqual(calls[2][1], {
    pool: { marker: 'pool' },
    empresaId: 1,
    executionId: '30',
    status: 'completada',
    metrics: {
      campanias: 2,
      registros_recibidos: 200,
      bytes: 87595
    }
  })
})

test('registra sin datos y conserva el error original', async () => {
  const finishes = []
  const original = Object.assign(
    new Error('contenido no persistido'),
    { code: 'BAZ_EMPTY_RESPONSE' }
  )

  await assert.rejects(
    () => monitorBancoAztecaExecution({
      pool: {},
      empresaId: 1,
      stage: 'extraccion',
      fallbackErrorCode: 'BAZ_EXPORT_UNEXPECTED',
      classifyResult: classifyExportResult,
      resolveContextFn: async () => ({
        origenId: '10',
        integracionId: '20'
      }),
      startFn: async () => ({ id: '30' }),
      finishFn: async input => {
        finishes.push(input)
      },
      operation: async () => {
        throw original
      }
    }),
    error => error === original
  )

  assert.deepEqual(finishes[0], {
    pool: {},
    empresaId: 1,
    executionId: '30',
    status: 'sin_datos',
    metrics: {},
    errorCode: 'BAZ_EMPTY_RESPONSE'
  })
})

test('una falla del monitoreo no bloquea la operación', async () => {
  const reports = []
  let operated = false

  const result = await monitorBancoAztecaExecution({
    pool: {},
    empresaId: 1,
    stage: 'importacion',
    fallbackErrorCode: 'BAZ_IMPORT_UNEXPECTED',
    classifyResult: classifyImportResult,
    resolveContextFn: async () => {
      throw Object.assign(new Error('interno'), {
        code: 'BAZ_EXECUTION_DATABASE_UNAVAILABLE'
      })
    },
    reportErrorFn: (phase, error) => {
      reports.push({ phase, code: error.code })
    },
    operation: async context => {
      operated = true
      assert.equal(context, null)
      return {
        status: 'already_imported',
        totalRows: 200
      }
    }
  })

  assert.equal(result.status, 'already_imported')
  assert.equal(operated, true)
  assert.deepEqual(reports, [
    {
      phase: 'resolve',
      code: 'BAZ_EXECUTION_DATABASE_UNAVAILABLE'
    }
  ])
})
