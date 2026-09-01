import { apiFetch } from './api'

const CACHE_TTL_MS = 30000
const cache = new Map()

export async function fetchPortfolioAlerts({
  originId = '',
  force = false
} = {}) {
  const params = new URLSearchParams()

  if (originId) {
    params.set('origen', originId)
  }

  const query = params.toString()
  const endpoint = query
    ? `/crm-api/cartera/alertas?${query}`
    : '/crm-api/cartera/alertas'
  const now = Date.now()
  const cached = cache.get(endpoint)

  if (
    !force
    && cached
    && cached.expiresAt > now
  ) {
    return cached.promise
  }

  const promise = apiFetch(endpoint)
    .then(async response => {
      const data = await response
        .json()
        .catch(() => ({}))

      if (!response.ok) {
        throw new Error(
          data.error
          || 'No fue posible consultar los pendientes'
        )
      }

      return data
    })
    .catch(error => {
      cache.delete(endpoint)
      throw error
    })

  cache.set(endpoint, {
    expiresAt: now + CACHE_TTL_MS,
    promise
  })

  return promise
}
