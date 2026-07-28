const XLSX = require('xlsx')

const HEADERS = Object.freeze([
  'IdCampaña',
  'IdCliente',
  'Nombre',
  'IdGenero',
  'Edad',
  'IdNivelRiesgo',
  'MedioContactoSugerido',
  'Teléfono 1',
  'Tipo Teléfono 1',
  'Teléfono 2',
  'Tipo Teléfono 2',
  'Teléfono 3',
  'Tipo Teléfono 3',
  'Teléfono 4',
  'Tipo Teléfono 4',
  'Correo 1',
  'Correo 2',
  'IdPais',
  'IdCanal',
  'IdSucursal',
  'Folio',
  'SemanasAtraso',
  'DiasAtraso',
  'DiaPago',
  'Saldo',
  'PagoRequerido',
  'PagoMinimo',
  'PagoNoGeneraIntereses',
  'AbonoPuntual',
  'AbonoSemanal',
  'FechaProximaPago',
  'FechaVencimiento',
  'Producto',
  'CodigoPostal'
])

function safeText(value) {
  if (value === null || value === undefined) return ''

  const text = String(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

function clientRow(client) {
  return [
    client.idCampania,
    safeText(client.idCliente),
    safeText(client.nombre),
    safeText(client.idGenero),
    client.edad,
    safeText(client.idNivelRiesgo),
    safeText(client.medioContactoSugerido),
    safeText(client.telefonos[0].numero),
    safeText(client.telefonos[0].tipo),
    safeText(client.telefonos[1].numero),
    safeText(client.telefonos[1].tipo),
    safeText(client.telefonos[2].numero),
    safeText(client.telefonos[2].tipo),
    safeText(client.telefonos[3].numero),
    safeText(client.telefonos[3].tipo),
    safeText(client.correos[0]),
    safeText(client.correos[1]),
    safeText(client.idPais),
    safeText(client.idCanal),
    safeText(client.idSucursal),
    safeText(client.folio),
    client.semanasAtraso,
    client.diasAtraso,
    client.diaPago,
    client.saldo,
    client.pagoRequerido,
    client.pagoMinimo,
    client.pagoNoGeneraIntereses,
    client.abonoPuntual,
    client.abonoSemanal,
    safeText(client.fechaProximaPago),
    safeText(client.fechaVencimiento),
    safeText(client.producto),
    safeText(client.codigoPostal)
  ]
}

async function createPortfolioWorkbook(clients) {
  const rows = [
    HEADERS,
    ...clients.map(clientRow)
  ]
  const sheet = XLSX.utils.aoa_to_sheet(rows)

  sheet['!autofilter'] = {
    ref: `A1:AH${Math.max(rows.length, 2)}`
  }

  sheet['!cols'] = HEADERS.map((header, index) => {
    const longest = rows.reduce(
      (length, row) =>
        Math.max(length, String(row[index] ?? '').length),
      header.length
    )

    return {
      wch: Math.min(Math.max(longest + 2, 12), 40)
    }
  })

  const workbook = XLSX.utils.book_new()
  workbook.Props = {
    Author: 'We-Tech CRM',
    CreatedDate: new Date()
  }
  XLSX.utils.book_append_sheet(workbook, sheet, 'Cartera')

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
    compression: true
  })
}

module.exports = {
  HEADERS,
  safeText,
  createPortfolioWorkbook
}
