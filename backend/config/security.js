const ORIGENES_PREDETERMINADOS = Object.freeze([
  'https://crm.we-tech.mx',
  'https://crm.cobranzalegalrosasyasociados.com'
])

function normalizarOrigenes(valor) {
  if (!valor) {
    return [...ORIGENES_PREDETERMINADOS]
  }

  return valor
    .split(',')
    .map(origen => origen.trim())
    .filter(Boolean)
}

function crearOpcionesCors(valor) {
  const permitidos = normalizarOrigenes(valor)

  return {
    origin(origen, callback) {
      if (!origen || permitidos.includes(origen)) {
        return callback(null, true)
      }

      return callback(new Error('Origen no autorizado'))
    },
    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS'
    ],
    allowedHeaders: [
      'Content-Type',
      'Authorization'
    ]
  }
}

module.exports = {
  ORIGENES_PREDETERMINADOS,
  normalizarOrigenes,
  crearOpcionesCors
}
