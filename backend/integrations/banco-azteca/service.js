const { getBancoAztecaConfig } = require('../../config/banco-azteca')
const { createBancoAztecaClient } = require('./client')
const { normalizeClients } = require('./normalizer')
const { createPortfolioWorkbook } = require('./excel')

function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error('La fecha debe tener formato AAAA-MM-DD')
  }

  const date = new Date(`${value}T00:00:00Z`)
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error('La fecha seleccionada no es válida')
  }

  return value
}

async function exportPortfolio(
  date,
  {
    env = process.env,
    fetchImpl,
    createWorkbook = createPortfolioWorkbook
  } = {}
) {
  const safeDate = validateDate(date)
  const config = getBancoAztecaConfig(env)
  const client = createBancoAztecaClient(config, { fetchImpl })

  const token = await client.getToken()
  const keys = await client.getKeys(token)
  const campaigns = await client.getCampaigns(
    token,
    keys.idAcceso,
    safeDate
  )

  const rawClients = []

  for (const campaign of campaigns) {
    const campaignId = Number.parseInt(campaign.idCampania, 10)
    if (!Number.isSafeInteger(campaignId) || campaignId <= 0) {
      continue
    }

    const campaignClients = await client.getAllClients(
      token,
      keys.idAcceso,
      campaignId
    )
    rawClients.push(...campaignClients)
  }

  const clients = normalizeClients(
    rawClients,
    keys.accesoPrivado
  )
  const buffer = await createWorkbook(clients)

  return {
    buffer,
    fileName: `Cartera_BancoAzteca_${safeDate}.xlsx`,
    campaigns: campaigns.length,
    clients: clients.length
  }
}

module.exports = {
  validateDate,
  exportPortfolio
}
