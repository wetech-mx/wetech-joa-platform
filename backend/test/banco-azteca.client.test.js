const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createBancoAztecaClient
} = require('../integrations/banco-azteca/client')

const CONFIG = Object.freeze({
  baseUrl: 'https://bank.example',
  consumerKey: 'key',
  consumerSecret: 'secret',
  idDespacho: 10,
  idEstatus: 20,
  idCanalEnvio: 30,
  timeoutMs: 5000,
  maxPages: 5
})

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  })
}

test('solicita token con Basic y client_credentials', async () => {
  let captured
  const client = createBancoAztecaClient(CONFIG, {
    fetchImpl: async (url, options) => {
      captured = { url, options }
      return jsonResponse({ access_token: 'temporary-token' })
    }
  })

  const token = await client.getToken()

  assert.equal(token, 'temporary-token')
  assert.match(captured.url, /oauth2\/v1\/token$/)
  assert.equal(captured.options.method, 'POST')
  assert.equal(
    captured.options.headers.Authorization,
    `Basic ${Buffer.from('key:secret').toString('base64')}`
  )
  assert.equal(
    captured.options.body.get('grant_type'),
    'client_credentials'
  )
})

test('pagina clientes y conserva el encabezado x-id-acceso', async () => {
  const pages = []
  const client = createBancoAztecaClient(CONFIG, {
    fetchImpl: async (url, options) => {
      pages.push({
        url: new URL(url),
        access: options.headers['x-id-acceso']
      })
      const page = Number(new URL(url).searchParams.get('numeroPagina'))

      return jsonResponse({
        resultado: {
          clientes: [{ idCliente: `encrypted-${page}` }],
          paginacion: { totalPaginas: 2 }
        }
      })
    }
  })

  const clients = await client.getAllClients(
    'token',
    'access-id',
    99
  )

  assert.equal(clients.length, 2)
  assert.deepEqual(
    pages.map(item => item.url.searchParams.get('numeroPagina')),
    ['1', '2']
  )
  assert.ok(
    pages.every(item => item.access === 'access-id')
  )
  assert.ok(
    pages.every(
      item => item.url.searchParams.get('idCampana') === '99'
    )
  )
})

test('no incluye el cuerpo sensible del banco en errores HTTP', async () => {
  const client = createBancoAztecaClient(CONFIG, {
    fetchImpl: async () => jsonResponse({
      access_token: 'TOKEN-QUE-NO-DEBE-SALIR'
    }, 401)
  })

  await assert.rejects(
    () => client.getToken(),
    error => {
      assert.equal(error.code, 'BAZ_HTTP_ERROR')
      assert.equal(
        error.message.includes('TOKEN-QUE-NO-DEBE-SALIR'),
        false
      )
      return true
    }
  )
})
