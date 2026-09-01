const {
  CarteraReadError,
  isValidIsoDate,
  normalizeOptionalBigintId,
  resolveAccessScope,
  resolvePortfolioOrigin
} = require('./cartera-read-repository')

function normalizeReportDate(value) {
  const date = String(value ?? '').trim()

  if (!date) {
    return null
  }

  if (!isValidIsoDate(date)) {
    throw new CarteraReadError(
      'CARTERA_REPORT_DATE_INVALID',
      'La fecha del corte debe usar el formato AAAA-MM-DD'
    )
  }

  return date
}

function normalizeReportFilters(query = {}) {
  return {
    date: normalizeReportDate(query.fecha),
    originId: normalizeOptionalBigintId(
      query.origen,
      'origen'
    ),
    executiveId: normalizeOptionalBigintId(
      query.ejecutivo,
      'ejecutivo'
    )
  }
}

function countValue(value) {
  const number = Number(value || 0)
  return Number.isSafeInteger(number) && number >= 0
    ? number
    : 0
}

function moneyNumber(value) {
  const number = Number(value || 0)
  return Number.isFinite(number)
    ? number
    : 0
}

async function resolveReportDate({
  pool,
  scope,
  filters
}) {
  if (filters.date) {
    return filters.date
  }

  const values = [scope.empresaId]
  const conditions = [
    'i.empresa_id = $1',
    "i.estado = 'completada'"
  ]

  if (filters.originId) {
    values.push(filters.originId)
    conditions.push(`i.origen_id = $${values.length}`)
  }

  const executiveId = scope.isExecutive
    ? scope.userId
    : filters.executiveId

  if (executiveId) {
    values.push(executiveId)
    conditions.push(`a.usuario_id = $${values.length}`)
  }

  const result = await pool.query(
    `
    SELECT MAX(i.fecha_cartera) AS fecha
    FROM public.cartera_importaciones i
    LEFT JOIN public.cartera_snapshots s
      ON s.importacion_id = i.id
    LEFT JOIN public.cartera_asignaciones a
      ON a.cuenta_id = s.cuenta_id
      AND a.activa = TRUE
    WHERE ${conditions.join('\n      AND ')}
    `,
    values
  )

  const date = result.rows[0]?.fecha || null

  if (!date) {
    throw new CarteraReadError(
      'CARTERA_REPORT_CUT_NOT_FOUND',
      'No existe un corte completado para los filtros seleccionados',
      404
    )
  }

  return String(date).slice(0, 10)
}

function buildCutStatement({
  scope,
  filters,
  date
}) {
  const values = [scope.empresaId, date]
  const conditions = [
    'i.empresa_id = $1',
    'i.fecha_cartera = $2',
    "i.estado = 'completada'"
  ]

  if (filters.originId) {
    values.push(filters.originId)
    conditions.push(`i.origen_id = $${values.length}`)
  }

  const executiveId = scope.isExecutive
    ? scope.userId
    : filters.executiveId

  if (executiveId) {
    values.push(executiveId)
    conditions.push(`a.usuario_id = $${values.length}`)
  }

  return {
    values,
    where: conditions.join('\n      AND ')
  }
}

function emptyExecutiveSummary(row) {
  return {
    executiveId: row.ejecutivo_id === null
      ? null
      : String(row.ejecutivo_id),
    executive: row.ejecutivo_nombre || 'Sin asignar',
    accounts: 0,
    managedAccounts: 0,
    unworked: 0,
    closed: 0,
    balance: 0,
    requiredPayment: 0,
    managementsToday: 0
  }
}

function summarizeCut(details, managementRows) {
  const byExecutive = new Map()
  const campaigns = new Set()

  for (const row of details) {
    const key = row.ejecutivo_id === null
      ? 'sin_asignar'
      : String(row.ejecutivo_id)
    const item = byExecutive.get(key)
      || emptyExecutiveSummary(row)

    item.accounts++
    item.balance += moneyNumber(row.saldo)
    item.requiredPayment += moneyNumber(row.pago_requerido)

    if (row.estado_gestion === 'cerrado') {
      item.closed++
    }

    campaigns.add(row.id_campania)
    byExecutive.set(key, item)
  }

  for (const row of managementRows) {
    const key = row.ejecutivo_id === null
      ? 'sin_asignar'
      : String(row.ejecutivo_id)
    const item = byExecutive.get(key)

    if (item) {
      item.managementsToday = countValue(row.total)
      item.managedAccounts = Math.min(
        item.accounts,
        countValue(row.cuentas_gestionadas)
      )
    }
  }

  for (const item of byExecutive.values()) {
    item.unworked = Math.max(
      0,
      item.accounts - item.managedAccounts
    )
  }

  const executives = [...byExecutive.values()].sort((left, right) => (
    left.executive.localeCompare(right.executive, 'es')
  ))
  const totals = executives.reduce(
    (summary, item) => ({
      accounts: summary.accounts + item.accounts,
      managedAccounts:
        summary.managedAccounts + item.managedAccounts,
      unworked: summary.unworked + item.unworked,
      closed: summary.closed + item.closed,
      balance: summary.balance + item.balance,
      requiredPayment:
        summary.requiredPayment + item.requiredPayment,
      managementsToday:
        summary.managementsToday + item.managementsToday
    }),
    {
      accounts: 0,
      managedAccounts: 0,
      unworked: 0,
      closed: 0,
      balance: 0,
      requiredPayment: 0,
      managementsToday: 0
    }
  )

  return {
    totals: {
      ...totals,
      campaigns: campaigns.size
    },
    executives
  }
}

async function getDailyCutReport({
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
  const filters = normalizeReportFilters(query)
  const origin = await resolvePortfolioOrigin({
    pool,
    scope,
    originId: filters.originId
  })
  const date = await resolveReportDate({
    pool,
    scope,
    filters
  })
  const statement = buildCutStatement({
    scope,
    filters,
    date
  })

  const detailsResult = await pool.query(
    `
    SELECT
      i.id AS importacion_id,
      i.fecha_cartera,
      c.id AS cuenta_id,
      o.nombre AS origen,
      c.id_campania,
      COALESCE(cp.nombre, c.id_campania) AS campania,
      c.id_cliente,
      c.folio,
      s.nombre AS cliente,
      s.id_nivel_riesgo AS riesgo,
      s.dias_atraso,
      s.semanas_atraso,
      s.saldo,
      s.pago_requerido,
      s.telefono_1,
      s.telefono_2,
      s.producto,
      c.estado_gestion,
      a.usuario_id AS ejecutivo_id,
      COALESCE(u.nombre, 'Sin asignar') AS ejecutivo_nombre
    FROM public.cartera_importaciones i
    INNER JOIN public.cartera_snapshots s
      ON s.importacion_id = i.id
    INNER JOIN public.cartera_cuentas c
      ON c.id = s.cuenta_id
      AND c.empresa_id = i.empresa_id
      AND c.origen_id = i.origen_id
    INNER JOIN public.crm_origenes o
      ON o.id = i.origen_id
      AND o.empresa_id = i.empresa_id
    LEFT JOIN public.cartera_campanias cp
      ON cp.empresa_id = c.empresa_id
      AND cp.origen_id = c.origen_id
      AND cp.codigo = c.id_campania
    LEFT JOIN public.cartera_asignaciones a
      ON a.cuenta_id = c.id
      AND a.activa = TRUE
    LEFT JOIN public.usuarios u
      ON u.id = a.usuario_id
    WHERE ${statement.where}
    ORDER BY
      COALESCE(u.nombre, 'Sin asignar'),
      s.nombre,
      c.id
    `,
    statement.values
  )

  if (detailsResult.rows.length === 0) {
    throw new CarteraReadError(
      'CARTERA_REPORT_CUT_NOT_FOUND',
      'El corte seleccionado no contiene cuentas dentro del alcance',
      404
    )
  }

  const managementResult = await pool.query(
    `
    SELECT
      g.usuario_id AS ejecutivo_id,
      COUNT(*) AS total,
      COUNT(DISTINCT g.cuenta_id) AS cuentas_gestionadas
    FROM public.cartera_gestiones g
    INNER JOIN public.cartera_cuentas c
      ON c.id = g.cuenta_id
      AND c.empresa_id = g.empresa_id
    INNER JOIN public.cartera_snapshots s
      ON s.cuenta_id = c.id
    INNER JOIN public.cartera_importaciones i
      ON i.id = s.importacion_id
      AND i.empresa_id = c.empresa_id
      AND i.origen_id = c.origen_id
    LEFT JOIN public.cartera_asignaciones a
      ON a.cuenta_id = c.id
      AND a.activa = TRUE
    WHERE ${statement.where}
      AND (
        g.creada_at AT TIME ZONE 'America/Mexico_City'
      )::DATE = $2::DATE
    GROUP BY g.usuario_id
    `,
    statement.values
  )

  const summary = summarizeCut(
    detailsResult.rows,
    managementResult.rows
  )

  return {
    scope: scope.isExecutive
      ? 'ejecutivo'
      : 'empresa',
    date,
    origin,
    filters: {
      originId: filters.originId,
      executiveId: scope.isExecutive
        ? String(scope.userId)
        : filters.executiveId
    },
    ...summary,
    details: detailsResult.rows
  }
}

async function listDailyCuts({
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
  const conditions = [
    'i.empresa_id = $1',
    "i.estado = 'completada'"
  ]

  if (originId) {
    values.push(originId)
    conditions.push(`i.origen_id = $${values.length}`)
  }

  if (scope.isExecutive) {
    values.push(scope.userId)
    conditions.push(`a.usuario_id = $${values.length}`)
  }

  const result = await pool.query(
    `
    SELECT
      i.fecha_cartera,
      i.origen_id,
      o.nombre AS origen,
      COUNT(DISTINCT s.cuenta_id) AS cuentas,
      MAX(i.finalizada_at) AS finalizada_at
    FROM public.cartera_importaciones i
    INNER JOIN public.crm_origenes o
      ON o.id = i.origen_id
      AND o.empresa_id = i.empresa_id
    INNER JOIN public.cartera_snapshots s
      ON s.importacion_id = i.id
    LEFT JOIN public.cartera_asignaciones a
      ON a.cuenta_id = s.cuenta_id
      AND a.activa = TRUE
    WHERE ${conditions.join('\n      AND ')}
    GROUP BY
      i.fecha_cartera,
      i.origen_id,
      o.nombre
    ORDER BY
      i.fecha_cartera DESC,
      o.nombre
    LIMIT 120
    `,
    values
  )

  return result.rows.map(row => ({
    ...row,
    cuentas: countValue(row.cuentas)
  }))
}

module.exports = {
  buildCutStatement,
  getDailyCutReport,
  listDailyCuts,
  normalizeReportDate,
  normalizeReportFilters,
  resolveReportDate,
  summarizeCut
}
