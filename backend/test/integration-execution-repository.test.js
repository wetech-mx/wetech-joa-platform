'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  IntegrationExecutionError,
  finishIntegrationExecution,
  listCompanyIntegrationExecutions,
  listIntegrationExecutions,
  normalizeErrorCode,
  normalizeMetrics,
  startIntegrationExecution
} = require(
  '../repositories/integration-execution-repository'
)

function transactionalContext(handler) {
  const calls = []
  const client = {
    async query(sql, params) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ sql: normalized, params })

      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) {
        return { rows: [] }
      }

      return handler(normalized, params, calls)
    },
    release() {
      calls.push({ sql: 'RELEASE' })
    }
  }

  return {
    calls,
    pool: {
      async connect() {
        return client
      }
    }
  }
}

test('acepta únicamente métricas operativas permitidas', () => {
  assert.deepEqual(
    normalizeMetrics({
      campanias: 2,
      registros_recibidos: 200,
      archivo_existente: false
    }),
    {
      campanias: 2,
      registros_recibidos: 200,
      archivo_existente: false
    }
  )

  assert.throws(
    () => normalizeMetrics({
      token: 'valor-no-permitido'
    }),
    error => (
      error.code
        === 'INTEGRATION_EXECUTION_METRIC_NOT_ALLOWED'
    )
  )
})

test('rechaza valores negativos o no enteros', () => {
  assert.throws(
    () => normalizeMetrics({
      registros_procesados: -1
    }),
    error => (
      error.code === 'INTEGRATION_EXECUTION_METRIC_INVALID'
    )
  )

  assert.throws(
    () => normalizeMetrics({
      bytes: 1.5
    }),
    IntegrationExecutionError
  )
})

test('solo admite códigos controlados sin mensajes', () => {
  assert.equal(
    normalizeErrorCode('BAZ_EMPTY_RESPONSE'),
    'BAZ_EMPTY_RESPONSE'
  )
  assert.throws(
    () => normalizeErrorCode('token=secreto'),
    error => (
      error.code
        === 'INTEGRATION_EXECUTION_ERROR_CODE_INVALID'
    )
  )
})

test('inicia una ejecución aislada por empresa', async () => {
  const context = transactionalContext(
    async sql => {
      if (sql.startsWith('SELECT integracion.id::TEXT')) {
        return {
          rows: [
            {
              integracion_id: '20',
              origen_id: '10'
            }
          ]
        }
      }

      if (sql.startsWith('INSERT INTO public.crm_integracion_ejecuciones')) {
        return {
          rows: [
            {
              id: '30',
              empresa_id: '1',
              origen_id: '10',
              integracion_id: '20',
              etapa: 'extraccion',
              disparador: 'programada',
              estado: 'iniciada',
              iniciada_at: '2026-08-04T13:15:00.000Z'
            }
          ]
        }
      }

      return { rows: [] }
    }
  )

  const result = await startIntegrationExecution({
    pool: context.pool,
    empresaId: 1,
    integracionId: '20',
    stage: 'extraccion',
    trigger: 'programada'
  })

  assert.equal(result.id, '30')
  assert.deepEqual(
    context.calls[1].params,
    ['1', '20']
  )
  assert.match(
    context.calls[1].sql,
    /integracion\.empresa_id = \$1::INTEGER/
  )
  assert.match(
    context.calls[1].sql,
    /integracion\.activo = TRUE/
  )
  assert.match(context.calls[1].sql, /FOR UPDATE/)
  assert.match(
    context.calls[2].sql,
    /INTEGRATION_EXECUTION_INTERRUPTED/
  )
  assert.deepEqual(
    context.calls[4].params,
    ['1', '20', 'extraccion', 'programada', '10']
  )
  assert.equal(context.calls.at(-2).sql, 'COMMIT')
  assert.equal(context.calls.at(-1).sql, 'RELEASE')
})

test('rechaza iniciar sobre otra empresa o integración inactiva', async () => {
  const context = transactionalContext(async () => ({ rows: [] }))

  await assert.rejects(
    () => startIntegrationExecution({
      pool: context.pool,
      empresaId: 1,
      integracionId: 99,
      stage: 'extraccion',
      trigger: 'programada'
    }),
    error => (
      error.code
        === 'INTEGRATION_EXECUTION_TARGET_NOT_FOUND'
    )
  )

  assert.equal(context.calls.at(-2).sql, 'ROLLBACK')
  assert.equal(context.calls.at(-1).sql, 'RELEASE')
})

test('rechaza dos ejecuciones simultáneas del conector', async () => {
  const context = transactionalContext(
    async sql => {
      if (sql.startsWith('SELECT integracion.id::TEXT')) {
        return {
          rows: [
            {
              integracion_id: '20',
              origen_id: '10'
            }
          ]
        }
      }

      if (
        sql.startsWith('SELECT id::TEXT AS id')
        && sql.includes("estado = 'iniciada'")
      ) {
        return { rows: [{ id: '29' }] }
      }

      return { rows: [] }
    }
  )

  await assert.rejects(
    () => startIntegrationExecution({
      pool: context.pool,
      empresaId: 1,
      integracionId: 20,
      stage: 'extraccion',
      trigger: 'programada'
    }),
    error => (
      error.code
        === 'INTEGRATION_EXECUTION_ALREADY_ACTIVE'
    )
  )

  assert.equal(context.calls.at(-2).sql, 'ROLLBACK')
})

test('finaliza sin datos y actualiza el resumen de integración', async () => {
  const context = transactionalContext(
    async sql => {
      if (sql.startsWith('UPDATE public.crm_integracion_ejecuciones')) {
        return {
          rows: [
            {
              id: '30',
              empresa_id: '1',
              origen_id: '10',
              integracion_id: '20',
              etapa: 'extraccion',
              disparador: 'programada',
              estado: 'sin_datos',
              iniciada_at: '2026-08-04T13:15:00.000Z',
              finalizada_at: '2026-08-04T13:15:03.000Z',
              duracion_ms: '3000',
              registros_recibidos: 0,
              registros_procesados: 0,
              metricas: {
                registros_recibidos: 0,
                registros_procesados: 0
              },
              error_codigo: 'BAZ_EMPTY_RESPONSE'
            }
          ]
        }
      }

      return { rows: [] }
    }
  )

  const result = await finishIntegrationExecution({
    pool: context.pool,
    empresaId: 1,
    executionId: 30,
    status: 'sin_datos',
    metrics: {
      registros_recibidos: 0,
      registros_procesados: 0
    },
    errorCode: 'BAZ_EMPTY_RESPONSE'
  })

  assert.equal(result.estado, 'sin_datos')
  assert.deepEqual(
    context.calls[1].params,
    [
      '1',
      '30',
      'sin_datos',
      0,
      0,
      JSON.stringify({
        registros_recibidos: 0,
        registros_procesados: 0
      }),
      'BAZ_EMPTY_RESPONSE'
    ]
  )
  assert.deepEqual(
    context.calls[2].params,
    [
      '1',
      '20',
      '2026-08-04T13:15:03.000Z',
      'sin_datos',
      'BAZ_EMPTY_RESPONSE'
    ]
  )
})

test('una falla exige un código controlado', async () => {
  await assert.rejects(
    () => finishIntegrationExecution({
      pool: {},
      empresaId: 1,
      executionId: 30,
      status: 'fallida'
    }),
    error => (
      error.code
        === 'INTEGRATION_EXECUTION_ERROR_CODE_REQUIRED'
    )
  )
})

test('una ejecución completada no admite código de error', async () => {
  await assert.rejects(
    () => finishIntegrationExecution({
      pool: {},
      empresaId: 1,
      executionId: 30,
      status: 'completada',
      errorCode: 'ERROR_QUE_NO_CORRESPONDE'
    }),
    error => (
      error.code
        === 'INTEGRATION_EXECUTION_ERROR_CODE_NOT_ALLOWED'
    )
  )
})

test('lista historial sin campos secretos y dentro de empresa', async () => {
  const calls = []
  const rows = [
    {
      id: '30',
      integracion_id: '20',
      estado: 'sin_datos',
      error_codigo: 'BAZ_EMPTY_RESPONSE'
    }
  ]

  const result = await listIntegrationExecutions({
    pool: {
      async query(sql, params) {
        calls.push({
          sql: String(sql).replace(/\s+/g, ' ').trim(),
          params
        })
        return { rows }
      }
    },
    empresaId: 1,
    integracionId: 20,
    limit: 25
  })

  assert.deepEqual(result, rows)
  assert.deepEqual(calls[0].params, ['1', '20', 25])
  assert.match(calls[0].sql, /ejecucion\.empresa_id = \$1/)
  assert.doesNotMatch(
    calls[0].sql,
    /referencia_secreto|configuracion_no_secreta/
  )
})

test('lista historial administrativo con filtros seguros y multiempresa', async () => {
  const calls = []
  const rows = [{
    id: '31',
    origen_nombre: 'Banco Azteca',
    integracion_nombre: 'API Banco Azteca',
    estado: 'sin_datos'
  }]

  const result = await listCompanyIntegrationExecutions({
    pool: {
      async query(sql, params) {
        calls.push({
          sql: String(sql).replace(/\s+/g, ' ').trim(),
          params
        })
        return { rows }
      }
    },
    empresaId: 7,
    origenId: '10',
    integracionId: '20',
    status: 'sin_datos',
    stage: 'extraccion',
    limit: 40
  })

  assert.deepEqual(result, rows)
  assert.deepEqual(
    calls[0].params,
    ['7', '10', '20', 'sin_datos', 'extraccion', 40]
  )
  assert.match(
    calls[0].sql,
    /ejecucion\.empresa_id = \$1::INTEGER/
  )
  assert.match(
    calls[0].sql,
    /integracion\.empresa_id = ejecucion\.empresa_id/
  )
  assert.match(
    calls[0].sql,
    /origen\.empresa_id = integracion\.empresa_id/
  )
  assert.doesNotMatch(
    calls[0].sql,
    /referencia_secreto|configuracion_no_secreta|error_detalle/
  )
})

test('rechaza filtros desconocidos del historial administrativo', async () => {
  await assert.rejects(
    () => listCompanyIntegrationExecutions({
      pool: { query: async () => ({ rows: [] }) },
      empresaId: 7,
      status: 'borrada'
    }),
    error => (
      error.code === 'INTEGRATION_EXECUTION_VALUE_INVALID'
    )
  )
})
