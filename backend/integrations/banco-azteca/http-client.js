const { BancoAztecaError } = require('./errors')

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function parseRetryAfter(value) {
  if (!value) return null

  const seconds = Number.parseInt(value, 10)
  if (Number.isSafeInteger(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30000)
  }

  return null
}

async function requestJson(
  url,
  options,
  {
    endpoint,
    timeoutMs,
    retries = 2,
    fetchImpl = fetch
  }
) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs)
      })

      const body = await response.text()

      if (!response.ok) {
        const retryable = RETRYABLE_STATUS.has(response.status)

        if (retryable && attempt < retries) {
          const retryAfter = parseRetryAfter(
            response.headers.get('retry-after')
          )
          await wait(retryAfter ?? 500 * (2 ** attempt))
          continue
        }

        throw new BancoAztecaError(
          `${endpoint} respondió HTTP ${response.status}`,
          {
            code: 'BAZ_HTTP_ERROR',
            httpStatus: response.status,
            retryable
          }
        )
      }

      if (!body.trim()) {
        throw new BancoAztecaError(
          `${endpoint} respondió sin contenido`,
          { code: 'BAZ_EMPTY_RESPONSE' }
        )
      }

      try {
        return JSON.parse(body)
      } catch {
        throw new BancoAztecaError(
          `${endpoint} devolvió una respuesta no válida`,
          { code: 'BAZ_INVALID_JSON' }
        )
      }
    } catch (error) {
      if (error instanceof BancoAztecaError) {
        throw error
      }

      const retryable =
        error?.name === 'TimeoutError' ||
        error?.name === 'AbortError' ||
        error instanceof TypeError

      if (retryable && attempt < retries) {
        await wait(500 * (2 ** attempt))
        continue
      }

      throw new BancoAztecaError(
        `${endpoint} no está disponible temporalmente`,
        {
          code: 'BAZ_NETWORK_ERROR',
          retryable
        }
      )
    }
  }

  throw new BancoAztecaError(
    `${endpoint} agotó los reintentos`,
    { code: 'BAZ_RETRIES_EXHAUSTED' }
  )
}

module.exports = {
  requestJson
}
