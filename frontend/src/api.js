const LOGIN_URL = '/crm-api/login'

export async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {})
  const token = localStorage.getItem('token')

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(url, {
    ...options,
    headers
  })

  if (response.status === 401 && url !== LOGIN_URL) {
    localStorage.removeItem('token')
    localStorage.removeItem('usuario')
    window.location.reload()
  }

  return response
}
