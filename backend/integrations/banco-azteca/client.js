const { requestJson } = require('./http-client')
const { BancoAztecaError } = require('./errors')

const PATHS = Object.freeze({
  token: '/socios-comerciales/oauth2/v1/token',
  keys: '/socios-comerciales/cobranza/seguridad/v1/aplicaciones/llaves',
  campaigns:
    '/socios-comerciales/investigacion-cobranza/' +
    'pagos-credito/campanias/v1/campanias',
  clients:
    '/socios-comerciales/investigacion-cobranza/' +
    'pagos-credito/campanias/v1/clientes'
})

function resultFrom(json, endpoint) {
  if (!json || typeof json.resultado !== 'object') {
    throw new BancoAztecaError(
      `${endpoint} no contiene resultado`,
      { code: 'BAZ_MISSING_RESULT' }
    )
  }

  return json.resultado
}

function createBancoAztecaClient(config, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || fetch

  function call(path, options, endpoint, retries = 2) {
    return requestJson(
      `${config.baseUrl}${path}`,
      options,
      {
        endpoint,
        timeoutMs: config.timeoutMs,
        retries,
        fetchImpl
      }
    )
  }

  async function getToken() {
    const credentials = Buffer.from(
      `${config.consumerKey}:${config.consumerSecret}`,
      'utf8'
    ).toString('base64')

    const json = await call(
      PATHS.token,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials'
        })
      },
      'TOKEN',
      1
    )

    if (!json.access_token) {
      throw new BancoAztecaError(
        'TOKEN no contiene access_token',
        { code: 'BAZ_MISSING_TOKEN' }
      )
    }

    return String(json.access_token)
  }

  async function getKeys(token) {
    const json = await call(
      PATHS.keys,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      },
      'LLAVES'
    )

    const result = resultFrom(json, 'LLAVES')

    if (!result.idAcceso || !result.accesoPrivado) {
      throw new BancoAztecaError(
        'LLAVES no contiene idAcceso o accesoPrivado',
        { code: 'BAZ_MISSING_KEYS' }
      )
    }

    return {
      idAcceso: String(result.idAcceso),
      accesoPrivado: String(result.accesoPrivado),
      fechaHoraExpiracion: result.fechaHoraExpiracion || null
    }
  }

  async function getCampaigns(token, idAccess, date) {
    const query = new URLSearchParams({
      idEstatus: String(config.idEstatus),
      idCanalEnvio: String(config.idCanalEnvio),
      idDespacho: String(config.idDespacho),
      fechaInicial: date,
      fechaFinal: date
    })

    const json = await call(
      `${PATHS.campaigns}?${query}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-id-acceso': idAccess
        }
      },
      'CAMPAÑAS'
    )

    const result = resultFrom(json, 'CAMPAÑAS')

    if (!Array.isArray(result.campanias)) {
      throw new BancoAztecaError(
        'CAMPAÑAS no contiene una lista válida',
        { code: 'BAZ_INVALID_CAMPAIGNS' }
      )
    }

    return result.campanias
  }

  async function getClientPage(
    token,
    idAccess,
    campaignId,
    page
  ) {
    const query = new URLSearchParams({
      idDespacho: String(config.idDespacho),
      idCampana: String(campaignId),
      numeroPagina: String(page)
    })

    const json = await call(
      `${PATHS.clients}?${query}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-id-acceso': idAccess
        }
      },
      'CLIENTES'
    )

    const result = resultFrom(json, 'CLIENTES')

    return {
      clients: Array.isArray(result.clientes)
        ? result.clientes
        : [],
      totalPages: Math.max(
        Number.parseInt(result.paginacion?.totalPaginas, 10) || 1,
        1
      )
    }
  }

  async function getAllClients(
    token,
    idAccess,
    campaignId
  ) {
    const clients = []
    let page = 1
    let totalPages = 1

    do {
      if (page > config.maxPages) {
        throw new BancoAztecaError(
          'La paginación excedió el límite de seguridad',
          { code: 'BAZ_PAGE_LIMIT' }
        )
      }

      const result = await getClientPage(
        token,
        idAccess,
        campaignId,
        page
      )

      clients.push(...result.clients)
      totalPages = result.totalPages
      page++
    } while (page <= totalPages)

    return clients
  }

  return {
    getToken,
    getKeys,
    getCampaigns,
    getClientPage,
    getAllClients
  }
}

module.exports = {
  PATHS,
  createBancoAztecaClient
}
