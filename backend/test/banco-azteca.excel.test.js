const test = require('node:test')
const assert = require('node:assert/strict')
const XLSX = require('xlsx')

const {
  HEADERS,
  safeText,
  createPortfolioWorkbook
} = require('../integrations/banco-azteca/excel')

function clientFixture() {
  return {
    idCampania: 1,
    idCliente: '000123',
    nombre: '=HYPERLINK("bad")',
    idGenero: 'M',
    edad: 30,
    idNivelRiesgo: '1',
    medioContactoSugerido: 'TEL',
    telefonos: Array.from({ length: 4 }, () => ({
      numero: '',
      tipo: ''
    })),
    correos: ['', ''],
    idPais: 'MX',
    idCanal: '1',
    idSucursal: '2',
    folio: '0003',
    semanasAtraso: 1,
    diasAtraso: 7,
    diaPago: 5,
    saldo: 1200.5,
    pagoRequerido: 100,
    pagoMinimo: 50,
    pagoNoGeneraIntereses: 200,
    abonoPuntual: 25,
    abonoSemanal: 30,
    fechaProximaPago: '2026-07-30',
    fechaVencimiento: '2026-08-30',
    producto: 'Producto',
    codigoPostal: '01234'
  }
}

test('Excel conserva las 34 columnas del programa original', () => {
  assert.equal(HEADERS.length, 34)
  assert.equal(HEADERS[0], 'IdCampaña')
  assert.equal(HEADERS[33], 'CodigoPostal')
})

test('neutraliza fórmulas provenientes de datos externos', () => {
  assert.equal(safeText('=2+2'), "'=2+2")
  assert.equal(safeText('@SUM(A1)'), "'@SUM(A1)")
  assert.equal(safeText('Fernando'), 'Fernando')
})

test('genera un libro XLSX legible sin escribirlo en disco', async () => {
  const buffer = await createPortfolioWorkbook([clientFixture()])
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheet = workbook.Sheets.Cartera
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true
  })

  assert.equal(rows[0].length, 34)
  assert.equal(rows[1][1], '000123')
  assert.equal(rows[1][2], '\'=HYPERLINK("bad")')
  assert.equal(rows[1][24], 1200.5)
})
