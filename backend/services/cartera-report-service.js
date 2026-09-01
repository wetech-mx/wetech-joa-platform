const XLSX = require('xlsx')

const {
  getDailyCutReport
} = require('../repositories/cartera-report-repository')

function safeSpreadsheetText(value) {
  const text = String(value ?? '')

  return /^[=+\-@]/.test(text)
    ? `'${text}`
    : text
}

function safeFilePart(value) {
  const text = String(value || 'Todos')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return text || 'Todos'
}

function reportWorkbook(report) {
  const summaryRows = [
    {
      Ejecutivo: 'TOTAL GENERAL',
      Cuentas: report.totals.accounts,
      'Cuentas gestionadas en el día': report.totals.managedAccounts,
      'Cuentas sin gestión en el día': report.totals.unworked,
      Cerradas: report.totals.closed,
      'Gestiones del día': report.totals.managementsToday,
      'Saldo total': report.totals.balance,
      'Pago requerido': report.totals.requiredPayment
    },
    ...report.executives.map(item => ({
      Ejecutivo: safeSpreadsheetText(item.executive),
      Cuentas: item.accounts,
      'Cuentas gestionadas en el día': item.managedAccounts,
      'Cuentas sin gestión en el día': item.unworked,
      Cerradas: item.closed,
      'Gestiones del día': item.managementsToday,
      'Saldo total': item.balance,
      'Pago requerido': item.requiredPayment
    }))
  ]

  const detailRows = report.details.map(row => ({
    'Fecha de cartera': report.date,
    Origen: safeSpreadsheetText(row.origen),
    Campaña: safeSpreadsheetText(row.campania),
    'Código campaña': safeSpreadsheetText(row.id_campania),
    Cliente: safeSpreadsheetText(row.cliente),
    'ID cliente': safeSpreadsheetText(row.id_cliente),
    Folio: safeSpreadsheetText(row.folio),
    Riesgo: safeSpreadsheetText(row.riesgo),
    'Días de atraso': row.dias_atraso,
    'Semanas de atraso': row.semanas_atraso,
    Saldo: moneyCell(row.saldo),
    'Pago requerido': moneyCell(row.pago_requerido),
    'Teléfono 1': safeSpreadsheetText(row.telefono_1),
    'Teléfono 2': safeSpreadsheetText(row.telefono_2),
    Producto: safeSpreadsheetText(row.producto),
    'Estado actual': safeSpreadsheetText(row.estado_gestion),
    Ejecutivo: safeSpreadsheetText(row.ejecutivo_nombre)
  }))

  const workbook = XLSX.utils.book_new()
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows)
  const detailSheet = XLSX.utils.json_to_sheet(detailRows)

  summarySheet['!cols'] = [
    { wch: 28 },
    { wch: 12 },
    { wch: 22 },
    { wch: 16 },
    { wch: 12 },
    { wch: 20 },
    { wch: 18 },
    { wch: 18 }
  ]
  detailSheet['!cols'] = [
    { wch: 16 },
    { wch: 22 },
    { wch: 30 },
    { wch: 22 },
    { wch: 34 },
    { wch: 24 },
    { wch: 24 },
    { wch: 30 },
    { wch: 16 },
    { wch: 20 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 24 },
    { wch: 22 },
    { wch: 28 }
  ]

  XLSX.utils.book_append_sheet(
    workbook,
    summarySheet,
    'Resumen'
  )
  XLSX.utils.book_append_sheet(
    workbook,
    detailSheet,
    'Detalle del corte'
  )

  return workbook
}

function moneyCell(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

async function exportDailyCutReport({
  pool,
  usuario,
  query
}) {
  const report = await getDailyCutReport({
    pool,
    usuario,
    query
  })
  const workbook = reportWorkbook(report)
  const buffer = XLSX.write(
    workbook,
    {
      type: 'buffer',
      bookType: 'xlsx',
      compression: true
    }
  )
  const target = report.scope === 'ejecutivo'
    ? report.executives[0]?.executive
    : query?.ejecutivo
      ? report.executives[0]?.executive
      : 'General'

  return {
    buffer,
    fileName:
      `Reporte_Corte_${report.date}_${safeFilePart(target)}.xlsx`,
    report
  }
}

module.exports = {
  exportDailyCutReport,
  reportWorkbook,
  safeFilePart,
  safeSpreadsheetText
}
