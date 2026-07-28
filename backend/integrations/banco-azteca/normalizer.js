const {
  createBankPrivateKey,
  decryptBankValue
} = require('./crypto')

function decryptMoney(value, privateKey) {
  const decrypted = decryptBankValue(value, privateKey).trim()

  if (!decrypted || decrypted.toLowerCase() === 'null') {
    return null
  }

  const number = Number(decrypted.replace(/[$,\s]/g, ''))
  return Number.isFinite(number) ? number : decrypted
}

function normalizeClient(client, privateKey) {
  const phones = Array.isArray(client.contactos?.telefonos)
    ? client.contactos.telefonos
    : []
  const emails = Array.isArray(client.contactos?.correos)
    ? client.contactos.correos
    : []
  const unique = client.clienteUnico || {}
  const address = client.domicilio || {}

  return {
    idCampania: client.idCampania ?? '',
    idCliente: decryptBankValue(client.idCliente, privateKey),
    nombre: decryptBankValue(client.nombre, privateKey),
    idGenero: client.idGenero ?? '',
    edad: client.edad ?? '',
    idNivelRiesgo: client.idNivelRiesgo ?? '',
    medioContactoSugerido: client.medioContactoSugerido ?? '',
    telefonos: Array.from({ length: 4 }, (_, index) => ({
      numero: phones[index]
        ? decryptBankValue(phones[index].numero, privateKey)
        : '',
      tipo: phones[index]?.tipo ?? ''
    })),
    correos: Array.from({ length: 2 }, (_, index) =>
      emails[index]
        ? decryptBankValue(emails[index], privateKey)
        : ''
    ),
    idPais: decryptBankValue(unique.idPais, privateKey),
    idCanal: decryptBankValue(unique.idCanal, privateKey),
    idSucursal: decryptBankValue(unique.idSucursal, privateKey),
    folio: decryptBankValue(unique.folio, privateKey),
    semanasAtraso: client.semanasAtraso ?? '',
    diasAtraso: client.diasAtraso ?? '',
    diaPago: client.diaPago ?? '',
    saldo: decryptMoney(client.saldo, privateKey),
    pagoRequerido: decryptMoney(client.pagoRequerido, privateKey),
    pagoMinimo: decryptMoney(client.pagoMinimo, privateKey),
    pagoNoGeneraIntereses: decryptMoney(
      client.pagoNoGeneraIntereses,
      privateKey
    ),
    abonoPuntual: decryptMoney(client.abonoPuntual, privateKey),
    abonoSemanal: decryptMoney(client.abonoSemanal, privateKey),
    fechaProximaPago: client.fechaProximaPago ?? '',
    fechaVencimiento: client.fechaVencimiento ?? '',
    producto: client.producto ?? '',
    codigoPostal: decryptBankValue(
      address.codigoPostal,
      privateKey
    )
  }
}

function normalizeClients(clients, privateKeyBase64) {
  const privateKey = createBankPrivateKey(privateKeyBase64)
  return clients.map(client => normalizeClient(client, privateKey))
}

module.exports = {
  normalizeClient,
  normalizeClients
}
