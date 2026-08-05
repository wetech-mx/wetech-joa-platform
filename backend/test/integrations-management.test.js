const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  assertSafeConfiguration,
  createIntegration,
  createOrigin,
  getIntegrationConnectionTarget,
  listIntegrations,
  listOrigins,
  normalizeBigintId,
  normalizeIntegrationInput,
  normalizeOriginInput,
  updateOrigin
} = require(
  '../repositories/integrations-management-repository'
)

function mockPool(responses) {
  const calls = []

  return {
    calls,
    async query(text, values) {
      calls.push({ text, values })
      const response = responses.shift()

      if (response instanceof Error) {
        throw response
      }

      if (!response) {
        throw new Error('Falta una respuesta simulada')
      }

      return response
    }
  }
}

const admin = {
  id: 1,
  rol: 'Administrador',
  empresa_id: 7
}

test('conserva identificadores BIGINT como texto', () => {
  assert.equal(
    normalizeBigintId('9007199254740993'),
    '9007199254740993'
  )
})

test('rechaza identificadores fuera de rango', () => {
  assert.throws(
    () => normalizeBigintId('9223372036854775808'),
    error => error.code === 'INTEGRATION_ID_INVALID'
  )
})

test('normaliza un origen permitido', () => {
  assert.deepEqual(
    normalizeOriginInput({
      codigo: 'cliente_demo',
      nombre: 'Cliente Demo',
      tipo: 'cliente_cobranza',
      metadatos: { region: 'centro' }
    }),
    {
      code: 'cliente_demo',
      name: 'Cliente Demo',
      type: 'cliente_cobranza',
      description: null,
      metadata: { region: 'centro' },
      active: true
    }
  )
})

test('rechaza códigos de origen inseguros', () => {
  assert.throws(
    () => normalizeOriginInput({
      codigo: 'Cliente Demo',
      nombre: 'Cliente Demo',
      tipo: 'otro'
    }),
    error => error.code === 'INTEGRATION_CODE_INVALID'
  )
})

test('normaliza una integración sin secretos', () => {
  const result = normalizeIntegrationInput({
    tipo_codigo: 'firebird',
    codigo: 'sae_firebird',
    nombre: 'SAE Firebird',
    producto: 'Aspel SAE',
    adaptador: 'aspel_sae_firebird',
    direccion: 'entrada',
    modo_ejecucion: 'programada',
    configuracion_no_secreta: {
      host: 'servidor-interno',
      port: 3050,
      solo_lectura: true
    }
  })

  assert.equal(result.typeCode, 'firebird')
  assert.equal(result.configuration.port, 3050)
})

test('rechaza contraseñas dentro de la configuración', () => {
  assert.throws(
    () => assertSafeConfiguration({
      host: 'servidor-interno',
      password: 'valor-no-permitido'
    }),
    error => error.code === 'INTEGRATION_SECRET_FORBIDDEN'
  )
})

test('rechaza llaves privadas dentro de valores anidados', () => {
  assert.throws(
    () => assertSafeConfiguration({
      ssh: {
        contenido: [
          '-----BEGIN',
          'PRIVATE KEY-----'
        ].join(' ')
      }
    }),
    error => error.code === 'INTEGRATION_SECRET_FORBIDDEN'
  )
})

test('rechaza referencia de secreto enviada por API', () => {
  assert.throws(
    () => normalizeIntegrationInput({
      tipo_codigo: 'sftp',
      codigo: 'sftp_demo',
      nombre: 'SFTP Demo',
      adaptador: 'sftp',
      referencia_secreto: 'servidor:ruta'
    }),
    error => error.code === 'INTEGRATION_SECRET_FORBIDDEN'
  )
})

test('lista orígenes exclusivamente por empresa', async () => {
  const pool = mockPool([{ rows: [] }])

  await listOrigins({ pool, usuario: admin })

  assert.deepEqual(pool.calls[0].values, [7])
  assert.match(pool.calls[0].text, /o\.empresa_id = \$1/)
})

test('lista integraciones exclusivamente por empresa y origen', async () => {
  const pool = mockPool([{ rows: [] }])

  await listIntegrations({
    pool,
    usuario: admin,
    originId: '9007199254740993'
  })

  assert.deepEqual(
    pool.calls[0].values,
    [7, '9007199254740993']
  )
  assert.match(pool.calls[0].text, /i\.empresa_id = \$1/)
  assert.doesNotMatch(
    pool.calls[0].text,
    /referencia_secreto\s+AS/
  )
})

test('resuelve objetivo técnico por empresa sin exponerlo en listados', async () => {
  const pool = mockPool([{
    rows: [{
      id: '20',
      adaptador: 'banco_azteca_api',
      referencia_secreto: 'servidor:referencia'
    }]
  }])

  const result = await getIntegrationConnectionTarget({
    pool,
    usuario: admin,
    integrationId: '20'
  })

  assert.equal(result.id, '20')
  assert.deepEqual(pool.calls[0].values, [7, '20'])
  assert.match(
    pool.calls[0].text,
    /i\.empresa_id = \$1[\s\S]*i\.id = \$2::BIGINT/
  )
  assert.match(pool.calls[0].text, /i\.referencia_secreto/)
})

test('crea un origen forzando empresa de la sesión', async () => {
  const created = {
    id: '20',
    codigo: 'cliente_demo'
  }
  const pool = mockPool([{ rows: [created] }])

  const result = await createOrigin({
    pool,
    usuario: admin,
    body: {
      empresa_id: 99,
      codigo: 'cliente_demo',
      nombre: 'Cliente Demo',
      tipo: 'cliente_cobranza'
    }
  })

  assert.equal(result, created)
  assert.equal(pool.calls[0].values[0], 7)
})

test('impide editar un origen de otra empresa', async () => {
  const pool = mockPool([{ rows: [] }])

  await assert.rejects(
    () => updateOrigin({
      pool,
      usuario: admin,
      originId: '55',
      body: { nombre: 'Intento externo' }
    }),
    error => (
      error.code === 'INTEGRATION_ORIGIN_NOT_FOUND'
      && error.status === 404
    )
  )

  assert.deepEqual(pool.calls[0].values, [7, '55'])
})

test('crea integración sin aceptar secreto desde el cliente', async () => {
  const pool = mockPool([
    {
      rows: [{
        id: '5',
        codigo: 'cliente_demo',
        nombre: 'Cliente Demo',
        tipo: 'cliente_cobranza',
        descripcion: null,
        metadatos: {},
        activo: true
      }]
    },
    { rows: [{ codigo: 'api_rest' }] },
    {
      rows: [{
        id: '9',
        secreto_configurado: false
      }]
    }
  ])

  const result = await createIntegration({
    pool,
    usuario: admin,
    originId: '5',
    body: {
      tipo_codigo: 'api_rest',
      codigo: 'api_cliente_demo',
      nombre: 'API Cliente Demo',
      adaptador: 'api_generica',
      configuracion_no_secreta: {
        base_url: 'https://api.example.invalid'
      }
    }
  })

  assert.equal(result.secreto_configurado, false)
  assert.equal(pool.calls[2].values[0], 7)
  assert.doesNotMatch(
    pool.calls[2].text,
    /referencia_secreto[\s,)]/
  )
})

test('traduce código duplicado a conflicto controlado', async () => {
  const duplicate = new Error('duplicado')
  duplicate.code = '23505'
  const pool = mockPool([duplicate])

  await assert.rejects(
    () => createOrigin({
      pool,
      usuario: admin,
      body: {
        codigo: 'cliente_demo',
        nombre: 'Cliente Demo',
        tipo: 'otro'
      }
    }),
    error => (
      error.code === 'INTEGRATION_CODE_CONFLICT'
      && error.status === 409
    )
  )
})

test('protege todas las rutas administrativas', () => {
  const routes = fs.readFileSync(
    path.join(__dirname, '../routes/integrations.routes.js'),
    'utf8'
  )

  assert.match(
    routes,
    /router\.use\(\s*verificaToken,\s*requiereEmpresa,\s*requiereAdmin\s*\)/
  )
  assert.match(
    routes,
    /'\/integraciones\/ejecuciones',\s*obtenerEjecuciones/
  )
})

test('registra las rutas de integraciones en el servidor', () => {
  const server = fs.readFileSync(
    path.join(__dirname, '../server.js'),
    'utf8'
  )

  assert.match(
    server,
    /app\.use\('\/api', integrationsRoutes\)/
  )
})
