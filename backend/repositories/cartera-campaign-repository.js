const {
  ROLES
} = require('../config/constants')

const {
  CarteraReadError,
  normalizeBigintId,
  normalizeOptionalBigintId,
  resolveAccessScope,
  resolvePortfolioOrigin
} = require('./cartera-read-repository')

function normalizeCampaignName(value) {
  const name = String(value ?? '').trim()

  if (name.length < 1 || name.length > 150) {
    throw new CarteraReadError(
      'CARTERA_CAMPAIGN_NAME_INVALID',
      'El nombre de la campaña debe contener entre 1 y 150 caracteres'
    )
  }

  return name
}

function normalizeCampaignActive(value) {
  if (typeof value !== 'boolean') {
    throw new CarteraReadError(
      'CARTERA_CAMPAIGN_ACTIVE_INVALID',
      'El estado de la campaña debe ser verdadero o falso'
    )
  }

  return value
}

function requireCampaignAdministrator(usuario) {
  if (
    usuario?.rol !== ROLES.ADMIN
    && usuario?.rol !== ROLES.SUPER_ADMIN
  ) {
    throw new CarteraReadError(
      'CARTERA_CAMPAIGN_FORBIDDEN',
      'El rol de la sesión no puede administrar campañas',
      403
    )
  }
}

async function listPortfolioCampaigns({
  pool,
  usuario,
  query = {}
}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new CarteraReadError(
      'CARTERA_POOL_INVALID',
      'La conexión de datos no es válida',
      500
    )
  }

  const scope = resolveAccessScope(usuario)
  const originId = normalizeOptionalBigintId(
    query.origen,
    'origen'
  )

  await resolvePortfolioOrigin({
    pool,
    scope,
    originId
  })

  const values = [scope.empresaId]
  const conditions = ['cp.empresa_id = $1']

  if (originId) {
    values.push(originId)
    conditions.push(`cp.origen_id = $${values.length}`)
  }

  const result = await pool.query(
    `
    SELECT
      cp.id,
      cp.origen_id,
      o.codigo AS origen_codigo,
      o.nombre AS origen_nombre,
      cp.codigo,
      cp.nombre,
      cp.activa,
      cp.primera_fecha_cartera,
      cp.ultima_fecha_cartera,
      COUNT(c.id) FILTER (
        WHERE c.activa = TRUE
          AND c.en_corte_actual = TRUE
      ) AS cuentas_corte_actual,
      cp.actualizada_at
    FROM public.cartera_campanias cp
    INNER JOIN public.crm_origenes o
      ON o.id = cp.origen_id
      AND o.empresa_id = cp.empresa_id
    LEFT JOIN public.cartera_cuentas c
      ON c.empresa_id = cp.empresa_id
      AND c.origen_id = cp.origen_id
      AND c.id_campania = cp.codigo
    WHERE ${conditions.join('\n      AND ')}
    GROUP BY
      cp.id,
      cp.origen_id,
      o.codigo,
      o.nombre,
      cp.codigo,
      cp.nombre,
      cp.activa,
      cp.primera_fecha_cartera,
      cp.ultima_fecha_cartera,
      cp.actualizada_at
    ORDER BY
      cp.activa DESC,
      cp.nombre,
      cp.id
    `,
    values
  )

  return result.rows.map(row => ({
    ...row,
    cuentas_corte_actual: Number(
      row.cuentas_corte_actual || 0
    )
  }))
}

async function updatePortfolioCampaign({
  pool,
  usuario,
  campaignId,
  input = {}
}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new CarteraReadError(
      'CARTERA_POOL_INVALID',
      'La conexión de datos no es válida',
      500
    )
  }

  requireCampaignAdministrator(usuario)
  const scope = resolveAccessScope(usuario)
  const id = normalizeBigintId(campaignId, 'campania')
  const name = normalizeCampaignName(input.nombre)
  const active = normalizeCampaignActive(input.activa)

  const result = await pool.query(
    `
    UPDATE public.cartera_campanias
    SET
      nombre = $3,
      activa = $4,
      actualizada_at = NOW()
    WHERE
      id = $1
      AND empresa_id = $2
    RETURNING
      id,
      origen_id,
      codigo,
      nombre,
      activa,
      primera_fecha_cartera,
      ultima_fecha_cartera,
      actualizada_at
    `,
    [
      id,
      scope.empresaId,
      name,
      active
    ]
  )

  if (!result.rows[0]) {
    throw new CarteraReadError(
      'CARTERA_CAMPAIGN_NOT_FOUND',
      'La campaña no existe dentro de la empresa',
      404
    )
  }

  return result.rows[0]
}

module.exports = {
  listPortfolioCampaigns,
  normalizeCampaignActive,
  normalizeCampaignName,
  requireCampaignAdministrator,
  updatePortfolioCampaign
}
