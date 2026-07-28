const {
  getBancoAztecaConfigStatus
} = require('../config/banco-azteca')
const {
  exportPortfolio
} = require('../integrations/banco-azteca/service')
const {
  BancoAztecaError
} = require('../integrations/banco-azteca/errors')

function configurationStatus(req, res) {
  res.json(getBancoAztecaConfigStatus())
}

async function exportBankPortfolio(req, res) {
  try {
    const result = await exportPortfolio(req.body?.fecha)

    console.info('Banco Azteca export completed', {
      userId: req.usuario.id,
      companyId: req.usuario.empresa_id,
      date: req.body.fecha,
      campaigns: result.campaigns,
      clients: result.clients
    })

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.' +
        'spreadsheetml.sheet',
      'Content-Disposition':
        `attachment; filename="${result.fileName}"`,
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff'
    })

    res.status(200).send(result.buffer)
  } catch (error) {
    if (
      error instanceof BancoAztecaError ||
      error.message?.startsWith('La fecha') ||
      error.message?.startsWith('Configuración Banco Azteca') ||
      error.message?.startsWith('BAZ_')
    ) {
      const configurationError =
        error.message.startsWith('Configuración Banco Azteca') ||
        error.message.startsWith('BAZ_')

      return res.status(configurationError ? 503 : 400).json({
        error: error.message,
        code: error.code || 'BAZ_VALIDATION_ERROR'
      })
    }

    console.error('Banco Azteca export failed', {
      userId: req.usuario?.id,
      code: error.code || 'UNEXPECTED_ERROR'
    })

    res.status(500).json({
      error: 'No fue posible generar la cartera',
      code: 'BAZ_EXPORT_ERROR'
    })
  }
}

module.exports = {
  configurationStatus,
  exportBankPortfolio
}
