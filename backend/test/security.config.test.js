const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizarOrigenes,
  crearOpcionesCors
} = require('../config/security')

function comprobarOrigen(opciones, origen) {
  return new Promise((resolve, reject) => {
    opciones.origin(origen, (error, permitido) => {
      if (error) {
        reject(error)
        return
      }

      resolve(permitido)
    })
  })
}

test('CORS incluye los dos dominios autorizados', () => {
  const origenes = normalizarOrigenes()

  assert.deepEqual(origenes, [
    'https://crm.we-tech.mx',
    'https://crm.cobranzalegalrosasyasociados.com'
  ])
})

test('CORS permite el dominio nuevo de Rosas y Asociados', async () => {
  const opciones = crearOpcionesCors()

  assert.equal(
    await comprobarOrigen(
      opciones,
      'https://crm.cobranzalegalrosasyasociados.com'
    ),
    true
  )
})

test('CORS conserva temporalmente crm.we-tech.mx', async () => {
  const opciones = crearOpcionesCors()

  assert.equal(
    await comprobarOrigen(
      opciones,
      'https://crm.we-tech.mx'
    ),
    true
  )
})

test('CORS permite peticiones sin encabezado Origin', async () => {
  const opciones = crearOpcionesCors()

  assert.equal(
    await comprobarOrigen(opciones, undefined),
    true
  )
})

test('CORS rechaza dominios no autorizados', async () => {
  const opciones = crearOpcionesCors()

  await assert.rejects(
    comprobarOrigen(
      opciones,
      'https://sitio-no-autorizado.example'
    ),
    /Origen no autorizado/
  )
})
