const {
  ROLES
} = require('../config/constants')

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 25
const MAX_BIGINT = 9223372036854775807n

class CarteraReadError extends Error {
  constructor(
    code,
    message,
    status = 400
  ) {
    super(message)
    this.name = 'CarteraReadError'
    this.code = code
    this.status = status
  }
}

function normalizeInteger(
  value,
  {
    field,
    defaultValue,
    maximum
  }
) {
  if (
    value === undefined
    || value === null
    || value === ''
  ) {
    return defaultValue
  }

  const text = String(value).trim()

  if (!/^[1-9]\d*$/.test(text)) {
    throw new CarteraReadError(
      'CARTERA_QUERY_INTEGER_INVALID',
      `${field} debe ser un entero positivo`
    )
  }

  const number = Number(text)

  if (!Number.isSafeInteger(number)) {
    throw new CarteraReadError(
      'CARTERA_QUERY_INTEGER_INVALID',
      `${field} está fuera del rango permitido`
    )
  }

  if (maximum && number > maximum) {
    return maximum
  }

  return number
}

function normalizeBigintId(
  value,
  field = 'id'
) {
  const text = String(value ?? '').trim()

  if (!/^[1-9]\d*$/.test(text)) {
    throw new CarteraReadError(
      'CARTERA_ID_INVALID',
      `${field} no es válido`
    )
  }

  const bigint = BigInt(text)

  if (bigint > MAX_BIGINT) {
    throw new CarteraReadError(
      'CARTERA_ID_INVALID',
      `${field} está fuera del rango permitido`
    )
  }

  return text
}

function normalizeOptionalBigintId(
  value,
  field
) {
  if (
    value === undefined
    || value === null
    || String(value).trim() === ''
  ) {
    return null
  }

  return normalizeBigintId(value, field)
}

function normalizeText(
  value,
  {
    field,
    maximum
  }
) {
  if (
    value === undefined
    || value === null
  ) {
    return null
  }

  const text = String(value).trim()

  if (!text) {
    return null
  }

  if (text.length > maximum) {
    throw new CarteraReadError(
      'CARTERA_QUERY_TEXT_TOO_LONG',
      `${field} excede la longitud permitida`
    )
  }

  return text
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const [
    year,
    month,
    day
  ] = value.split('-').map(Number)

  const date = new Date(
    Date.UTC(year, month - 1, day)
  )

  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  )
}

function normalizeDate(value) {
  const text = normalizeText(
    value,
    {
      field: 'fecha',
      maximum: 10
    }
  )

  if (text === null) {
    return null
  }

  if (!isValidIsoDate(text)) {
    throw new CarteraReadError(
      'CARTERA_QUERY_DATE_INVALID',
      'fecha debe tener el formato AAAA-MM-DD'
    )
  }

  return text
}

function normalizeActive(value) {
  if (
    value === undefined
    || value === null
    || value === ''
  ) {
    return true
  }

  const text = String(value)
    .trim()
    .toLowerCase()

  if (text === 'true') {
    return true
  }

  if (text === 'false') {
    return false
  }

  if (
    text === 'todas'
    || text === 'all'
  ) {
    return null
  }

  throw new CarteraReadError(
    'CARTERA_QUERY_ACTIVE_INVALID',
    'activa debe ser true, false o todas'
  )
}

function normalizeListFilters(query = {}) {
  return {
    page: normalizeInteger(
      query.page,
      {
        field: 'page',
        defaultValue: 1
      }
    ),
    limit: normalizeInteger(
      query.limit,
      {
        field: 'limit',
        defaultValue: DEFAULT_LIMIT,
        maximum: MAX_LIMIT
      }
    ),
    search: normalizeText(
      query.busqueda,
      {
        field: 'busqueda',
        maximum: 150
      }
    ),
    campaign: normalizeText(
      query.campania,
      {
        field: 'campania',
        maximum: 100
      }
    ),
    status: normalizeText(
      query.estado,
      {
        field: 'estado',
        maximum: 50
      }
    ),
    risk: normalizeText(
      query.riesgo,
      {
        field: 'riesgo',
        maximum: 100
      }
    ),
    executiveId: normalizeInteger(
      query.ejecutivo,
      {
        field: 'ejecutivo',
        defaultValue: null
      }
    ),
    originId: normalizeOptionalBigintId(
      query.origen,
      'origen'
    ),
    date: normalizeDate(query.fecha),
    active: normalizeActive(query.activa)
  }
}

function normalizeJwtInteger(
  value,
  field
) {
  try {
    return normalizeInteger(
      value,
      {
        field,
        defaultValue: null
      }
    )
  } catch {
    throw new CarteraReadError(
      'CARTERA_ACCESS_INVALID',
      'La sesión no contiene un alcance válido',
      403
    )
  }
}

function resolveAccessScope(usuario = {}) {
  const empresaId = normalizeJwtInteger(
    usuario.empresa_id,
    'empresa_id'
  )

  if (!empresaId) {
    throw new CarteraReadError(
      'CARTERA_COMPANY_REQUIRED',
      'La sesión no tiene una empresa válida',
      403
    )
  }

  const allowedRoles = new Set([
    ROLES.SUPER_ADMIN,
    ROLES.ADMIN,
    ROLES.EJECUTIVO
  ])

  if (!allowedRoles.has(usuario.rol)) {
    throw new CarteraReadError(
      'CARTERA_ROLE_FORBIDDEN',
      'El rol de la sesión no puede consultar cartera',
      403
    )
  }

  const isExecutive =
    usuario.rol === ROLES.EJECUTIVO

  const userId = isExecutive
    ? normalizeJwtInteger(usuario.id, 'usuario_id')
    : null

  if (isExecutive && !userId) {
    throw new CarteraReadError(
      'CARTERA_USER_REQUIRED',
      'La sesión no tiene un usuario válido',
      403
    )
  }

  return {
    empresaId,
    isExecutive,
    userId
  }
}

async function resolvePortfolioOrigin({
  pool,
  scope,
  originId
}) {
  if (!originId) {
    return null
  }

  const result = await pool.query(
    `
    SELECT
      id,
      codigo,
      nombre,
      tipo
    FROM public.crm_origenes
    WHERE
      id = $1
      AND empresa_id = $2
      AND activo = TRUE
    LIMIT 1
    `,
    [
      originId,
      scope.empresaId
    ]
  )

  if (!result.rows[0]) {
    throw new CarteraReadError(
      'CARTERA_ORIGIN_NOT_FOUND',
      'El origen solicitado no pertenece a la empresa',
      404
    )
  }

  return result.rows[0]
}

function addCondition(
  conditions,
  values,
  expression,
  value
) {
  values.push(value)
  conditions.push(
    expression.replace(
      '?',
      `$${values.length}`
    )
  )
}

function buildListStatement({
  filters,
  scope
}) {
  const conditions = []
  const values = []

  addCondition(
    conditions,
    values,
    'c.empresa_id = ?',
    scope.empresaId
  )

  if (filters.originId) {
    addCondition(
      conditions,
      values,
      'c.origen_id = ?',
      filters.originId
    )
  }

  if (scope.isExecutive) {
    addCondition(
      conditions,
      values,
      'a.usuario_id = ?',
      scope.userId
    )
  } else if (filters.executiveId) {
    addCondition(
      conditions,
      values,
      'a.usuario_id = ?',
      filters.executiveId
    )
  }

  if (filters.active !== null) {
    addCondition(
      conditions,
      values,
      'c.activa = ?',
      filters.active
    )
  }

  if (filters.campaign) {
    addCondition(
      conditions,
      values,
      'c.id_campania = ?',
      filters.campaign
    )
  }

  if (filters.status) {
    addCondition(
      conditions,
      values,
      'c.estado_gestion = ?',
      filters.status
    )
  }

  if (filters.risk) {
    addCondition(
      conditions,
      values,
      's.id_nivel_riesgo = ?',
      filters.risk
    )
  }

  if (filters.date) {
    addCondition(
      conditions,
      values,
      'c.ultima_fecha_cartera = ?',
      filters.date
    )
  }

  if (filters.search) {
    values.push(`%${filters.search}%`)

    conditions.push(`
      (
        LOWER(COALESCE(s.nombre, ''))
          LIKE LOWER($${values.length})
        OR LOWER(c.id_cliente)
          LIKE LOWER($${values.length})
        OR LOWER(c.folio)
          LIKE LOWER($${values.length})
        OR LOWER(COALESCE(s.telefono_1, ''))
          LIKE LOWER($${values.length})
        OR LOWER(COALESCE(s.telefono_2, ''))
          LIKE LOWER($${values.length})
        OR LOWER(COALESCE(s.correo_1, ''))
          LIKE LOWER($${values.length})
      )
    `)
  }

  const from = `
    FROM public.cartera_cuentas c
    LEFT JOIN public.cartera_snapshots s
      ON s.cuenta_id = c.id
      AND s.importacion_id =
        c.ultima_importacion_id
    LEFT JOIN public.cartera_asignaciones a
      ON a.cuenta_id = c.id
      AND a.activa = TRUE
    LEFT JOIN public.usuarios u
      ON u.id = a.usuario_id
    INNER JOIN public.crm_origenes o
      ON o.id = c.origen_id
      AND o.empresa_id = c.empresa_id
  `

  const where = `
    WHERE ${conditions.join('\n      AND ')}
  `

  return {
    from,
    where,
    values
  }
}

async function listPortfolio({
  pool,
  usuario,
  query
}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new CarteraReadError(
      'CARTERA_POOL_INVALID',
      'La conexión de datos no es válida',
      500
    )
  }

  const filters = normalizeListFilters(query)
  const scope = resolveAccessScope(usuario)
  const origin = await resolvePortfolioOrigin({
    pool,
    scope,
    originId: filters.originId
  })
  const statement = buildListStatement({
    filters,
    scope
  })

  const countResult = await pool.query(
    `
    SELECT COUNT(*) AS total
    ${statement.from}
    ${statement.where}
    `,
    statement.values
  )

  const total = Number(
    countResult.rows[0]?.total || 0
  )

  const listValues = [
    ...statement.values,
    filters.limit,
    (filters.page - 1) * filters.limit
  ]

  const limitPlaceholder =
    `$${statement.values.length + 1}`
  const offsetPlaceholder =
    `$${statement.values.length + 2}`

  const result = await pool.query(
    `
    SELECT
      c.id,
      c.origen_id,
      o.codigo AS origen_codigo,
      o.nombre AS origen_nombre,
      c.id_campania,
      c.id_cliente,
      c.folio,
      c.estado_gestion,
      c.activa,
      c.primera_fecha_cartera,
      c.ultima_fecha_cartera,
      s.nombre,
      s.id_nivel_riesgo,
      s.medio_contacto_sugerido,
      s.telefono_1,
      s.saldo,
      s.pago_requerido,
      s.semanas_atraso,
      s.dias_atraso,
      s.producto,
      a.id AS asignacion_id,
      a.usuario_id AS ejecutivo_id,
      a.metodo AS asignacion_metodo,
      a.asignada_at,
      u.nombre AS ejecutivo_nombre
    ${statement.from}
    ${statement.where}
    ORDER BY
      c.ultima_fecha_cartera DESC,
      c.id DESC
    LIMIT ${limitPlaceholder}
    OFFSET ${offsetPlaceholder}
    `,
    listValues
  )

  return {
    data: result.rows,
    origin,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: total === 0
        ? 0
        : Math.ceil(total / filters.limit)
    }
  }
}

function normalizeManagementFilters(query = {}) {
  const from = normalizeDate(query.desde)
  const to = normalizeDate(query.hasta)

  if (from && to && from > to) {
    throw new CarteraReadError(
      'CARTERA_QUERY_DATE_RANGE_INVALID',
      'La fecha inicial no puede ser posterior a la final'
    )
  }

  return {
    page: normalizeInteger(
      query.page,
      {
        field: 'page',
        defaultValue: 1
      }
    ),
    limit: normalizeInteger(
      query.limit,
      {
        field: 'limit',
        defaultValue: DEFAULT_LIMIT,
        maximum: MAX_LIMIT
      }
    ),
    search: normalizeText(
      query.busqueda,
      {
        field: 'busqueda',
        maximum: 150
      }
    ),
    result: normalizeText(
      query.resultado,
      {
        field: 'resultado',
        maximum: 100
      }
    ),
    executiveId: normalizeInteger(
      query.ejecutivo,
      {
        field: 'ejecutivo',
        defaultValue: null
      }
    ),
    originId: normalizeOptionalBigintId(
      query.origen,
      'origen'
    ),
    from,
    to
  }
}

function buildManagementListStatement({
  filters,
  scope
}) {
  const conditions = []
  const values = []

  addCondition(
    conditions,
    values,
    'c.empresa_id = ?',
    scope.empresaId
  )

  if (filters.originId) {
    addCondition(
      conditions,
      values,
      'c.origen_id = ?',
      filters.originId
    )
  }

  if (scope.isExecutive) {
    addCondition(
      conditions,
      values,
      'a.usuario_id = ?',
      scope.userId
    )
  } else if (filters.executiveId) {
    addCondition(
      conditions,
      values,
      'g.usuario_id = ?',
      filters.executiveId
    )
  }

  if (filters.result) {
    values.push(filters.result.toLowerCase())
    conditions.push(`
      (
        LOWER(g.tipificacion_codigo) = LOWER($${values.length})
        OR LOWER(g.tipificacion_nombre) = LOWER($${values.length})
        OR LOWER(COALESCE(g.codigo_resultado, ''))
          = LOWER($${values.length})
      )
    `)
  }

  if (filters.from) {
    addCondition(
      conditions,
      values,
      'g.creada_at >= ?::DATE',
      filters.from
    )
  }

  if (filters.to) {
    addCondition(
      conditions,
      values,
      "g.creada_at < (?::DATE + INTERVAL '1 day')",
      filters.to
    )
  }

  if (filters.search) {
    values.push(`%${filters.search}%`)
    conditions.push(`
      (
        LOWER(COALESCE(s.nombre, ''))
          LIKE LOWER($${values.length})
        OR LOWER(c.id_cliente)
          LIKE LOWER($${values.length})
        OR LOWER(c.folio)
          LIKE LOWER($${values.length})
        OR LOWER(COALESCE(g.telefono_contactado, ''))
          LIKE LOWER($${values.length})
        OR LOWER(COALESCE(g.persona_contactada, ''))
          LIKE LOWER($${values.length})
        OR LOWER(COALESCE(g.notas, ''))
          LIKE LOWER($${values.length})
      )
    `)
  }

  return {
    from: `
      FROM public.cartera_gestiones g
      INNER JOIN public.cartera_cuentas c
        ON c.id = g.cuenta_id
      LEFT JOIN public.cartera_snapshots s
        ON s.cuenta_id = c.id
        AND s.importacion_id = c.ultima_importacion_id
      LEFT JOIN public.cartera_asignaciones a
        ON a.cuenta_id = c.id
        AND a.activa = TRUE
      LEFT JOIN public.usuarios gestor
        ON gestor.id = g.usuario_id
      INNER JOIN public.crm_origenes o
        ON o.id = c.origen_id
        AND o.empresa_id = c.empresa_id
    `,
    where: `
      WHERE ${conditions.join('\n        AND ')}
    `,
    values
  }
}

async function listPortfolioManagements({
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
  const filters = normalizeManagementFilters(query)
  const origin = await resolvePortfolioOrigin({
    pool,
    scope,
    originId: filters.originId
  })
  const statement = buildManagementListStatement({
    filters,
    scope
  })

  const countResult = await pool.query(
    `
    SELECT COUNT(*) AS total
    ${statement.from}
    ${statement.where}
    `,
    statement.values
  )
  const total = Number(countResult.rows[0]?.total || 0)
  const listValues = [
    ...statement.values,
    filters.limit,
    (filters.page - 1) * filters.limit
  ]
  const limitPlaceholder = `$${statement.values.length + 1}`
  const offsetPlaceholder = `$${statement.values.length + 2}`

  const result = await pool.query(
    `
    SELECT
      g.id,
      g.cuenta_id,
      g.tipificacion_id,
      g.tipificacion_codigo,
      g.tipificacion_nombre,
      g.prioridad,
      g.estado_resultante,
      g.codigo_resultado,
      g.canal,
      g.telefono_contactado,
      g.persona_contactada,
      g.relacion_contacto,
      g.promesa_monto,
      g.promesa_fecha,
      g.promesa_estado,
      g.proximo_seguimiento_at,
      g.seguimiento_estado,
      g.notas,
      g.evidencia,
      g.creada_at,
      g.usuario_id AS gestor_id,
      gestor.nombre AS gestor_nombre,
      c.origen_id,
      o.nombre AS origen_nombre,
      c.id_campania,
      c.id_cliente,
      c.folio,
      s.nombre AS cliente_nombre
    ${statement.from}
    ${statement.where}
    ORDER BY
      g.creada_at DESC,
      g.id DESC
    LIMIT ${limitPlaceholder}
    OFFSET ${offsetPlaceholder}
    `,
    listValues
  )

  return {
    data: result.rows,
    origin,
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: total === 0
        ? 0
        : Math.ceil(total / filters.limit)
    }
  }
}

function buildSummaryStatement(
  scope,
  originId = null
) {
  const values = [scope.empresaId]
  const conditions = [
    'c.empresa_id = $1',
    'c.activa = TRUE'
  ]

  if (scope.isExecutive) {
    values.push(scope.userId)
    conditions.push(
      `a.usuario_id = $${values.length}`
    )
  }

  if (originId) {
    values.push(originId)
    conditions.push(
      `c.origen_id = $${values.length}`
    )
  }

  return {
    from: `
      FROM public.cartera_cuentas c
      LEFT JOIN public.cartera_snapshots s
        ON s.cuenta_id = c.id
        AND s.importacion_id =
          c.ultima_importacion_id
      LEFT JOIN public.cartera_asignaciones a
        ON a.cuenta_id = c.id
        AND a.activa = TRUE
      LEFT JOIN public.usuarios u
        ON u.id = a.usuario_id
    `,
    where: `
      WHERE ${conditions.join('\n        AND ')}
    `,
    values
  }
}

function countValue(value) {
  const number = Number(value || 0)

  return Number.isSafeInteger(number)
    && number >= 0
    ? number
    : 0
}

function moneyValue(value) {
  const text = String(value ?? '0').trim()

  return /^-?\d+(\.\d+)?$/.test(text)
    ? text
    : '0'
}

async function getPortfolioSummary({
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
  const origin = await resolvePortfolioOrigin({
    pool,
    scope,
    originId
  })
  const statement = buildSummaryStatement(
    scope,
    originId
  )

  const [
    totalsResult,
    statesResult,
    risksResult,
    executivesResult
  ] = await Promise.all([
    pool.query(
      `
      SELECT
        COUNT(*) AS total_cuentas,
        COUNT(*) FILTER (
          WHERE a.id IS NOT NULL
        ) AS asignadas,
        COUNT(*) FILTER (
          WHERE a.id IS NULL
        ) AS sin_asignar,
        COUNT(
          DISTINCT c.id_campania
        ) AS campanias,
        COALESCE(
          SUM(s.saldo),
          0
        ) AS saldo_total,
        COALESCE(
          SUM(s.pago_requerido),
          0
        ) AS pago_requerido_total,
        MAX(c.ultima_fecha_cartera)
          AS ultima_fecha_cartera
      ${statement.from}
      ${statement.where}
      `,
      statement.values
    ),
    pool.query(
      `
      SELECT
        c.estado_gestion AS estado,
        COUNT(*) AS total
      ${statement.from}
      ${statement.where}
      GROUP BY c.estado_gestion
      ORDER BY
        COUNT(*) DESC,
        c.estado_gestion
      `,
      statement.values
    ),
    pool.query(
      `
      SELECT
        COALESCE(
          NULLIF(s.id_nivel_riesgo, ''),
          'Sin nivel'
        ) AS riesgo,
        COUNT(*) AS total
      ${statement.from}
      ${statement.where}
      GROUP BY 1
      ORDER BY
        COUNT(*) DESC,
        riesgo
      `,
      statement.values
    ),
    pool.query(
      `
      SELECT
        a.usuario_id AS ejecutivo_id,
        COALESCE(
          u.nombre,
          'Sin asignar'
        ) AS ejecutivo,
        COUNT(*) AS total
      ${statement.from}
      ${statement.where}
      GROUP BY
        a.usuario_id,
        u.nombre
      ORDER BY
        COUNT(*) DESC,
        ejecutivo
      `,
      statement.values
    )
  ])

  const totals = totalsResult.rows[0] || {}

  return {
    scope: scope.isExecutive
      ? 'ejecutivo'
      : 'empresa',
    origin,
    totals: {
      accounts: countValue(totals.total_cuentas),
      assigned: countValue(totals.asignadas),
      unassigned: countValue(totals.sin_asignar),
      campaigns: countValue(totals.campanias),
      balance: moneyValue(totals.saldo_total),
      requiredPayment: moneyValue(
        totals.pago_requerido_total
      ),
      portfolioDate:
        totals.ultima_fecha_cartera || null
    },
    states: statesResult.rows.map(row => ({
      state: row.estado,
      total: countValue(row.total)
    })),
    risks: risksResult.rows.map(row => ({
      risk: row.riesgo,
      total: countValue(row.total)
    })),
    executives: executivesResult.rows.map(row => ({
      id: row.ejecutivo_id === null
        ? null
        : String(row.ejecutivo_id),
      name: row.ejecutivo,
      total: countValue(row.total)
    }))
  }
}

async function getPortfolioAccount({
  pool,
  usuario,
  accountId
}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new CarteraReadError(
      'CARTERA_POOL_INVALID',
      'La conexión de datos no es válida',
      500
    )
  }

  const id = normalizeBigintId(
    accountId,
    'id'
  )
  const scope = resolveAccessScope(usuario)
  const values = [
    id,
    scope.empresaId
  ]
  let executiveCondition = ''

  if (scope.isExecutive) {
    values.push(scope.userId)
    executiveCondition =
      `AND a.usuario_id = $${values.length}`
  }

  const result = await pool.query(
    `
    SELECT
      c.id,
      c.origen_id,
      o.codigo AS origen_codigo,
      o.nombre AS origen_nombre,
      c.id_campania,
      c.id_cliente,
      c.folio,
      c.estado_gestion,
      c.activa,
      c.primera_fecha_cartera,
      c.ultima_fecha_cartera,
      c.creada_at,
      c.actualizada_at,
      s.id AS snapshot_id,
      s.nombre,
      s.id_genero,
      s.edad,
      s.id_nivel_riesgo,
      s.medio_contacto_sugerido,
      s.telefono_1,
      s.tipo_telefono_1,
      s.telefono_2,
      s.tipo_telefono_2,
      s.telefono_3,
      s.tipo_telefono_3,
      s.telefono_4,
      s.tipo_telefono_4,
      s.correo_1,
      s.correo_2,
      s.id_pais,
      s.id_canal,
      s.id_sucursal,
      s.semanas_atraso,
      s.dias_atraso,
      s.dia_pago,
      s.saldo,
      s.pago_requerido,
      s.pago_minimo,
      s.pago_no_genera_intereses,
      s.abono_puntual,
      s.abono_semanal,
      s.fecha_proxima_pago,
      s.fecha_vencimiento,
      s.producto,
      s.codigo_postal,
      s.datos_origen,
      a.id AS asignacion_id,
      a.usuario_id AS ejecutivo_id,
      a.metodo AS asignacion_metodo,
      a.motivo AS asignacion_motivo,
      a.asignada_at,
      u.nombre AS ejecutivo_nombre
    FROM public.cartera_cuentas c
    LEFT JOIN public.cartera_snapshots s
      ON s.cuenta_id = c.id
      AND s.importacion_id =
        c.ultima_importacion_id
    LEFT JOIN public.cartera_asignaciones a
      ON a.cuenta_id = c.id
      AND a.activa = TRUE
    LEFT JOIN public.usuarios u
      ON u.id = a.usuario_id
    INNER JOIN public.crm_origenes o
      ON o.id = c.origen_id
      AND o.empresa_id = c.empresa_id
    WHERE
      c.id = $1
      AND c.empresa_id = $2
      ${executiveCondition}
    LIMIT 1
    `,
    values
  )

  if (!result.rows[0]) {
    throw new CarteraReadError(
      'CARTERA_ACCOUNT_NOT_FOUND',
      'La cuenta de cartera no existe',
      404
    )
  }

  const history = await pool.query(
    `
    SELECT
      h.id,
      h.evento,
      h.detalle,
      h.valor_anterior,
      h.valor_nuevo,
      h.creada_at,
      h.usuario_id,
      u.nombre AS usuario_nombre,
      h.gestion_id,
      g.tipificacion_id,
      g.tipificacion_codigo,
      g.tipificacion_nombre,
      g.prioridad,
      g.estado_resultante,
      g.codigo_resultado,
      g.canal,
      g.telefono_contactado,
      g.persona_contactada,
      g.relacion_contacto,
      g.promesa_monto,
      g.promesa_fecha,
      g.promesa_estado,
      g.proximo_seguimiento_at,
      g.seguimiento_estado,
      g.evidencia
    FROM public.cartera_historial h
    LEFT JOIN public.usuarios u
      ON u.id = h.usuario_id
    LEFT JOIN public.cartera_gestiones g
      ON g.id = h.gestion_id
      AND g.cuenta_id = h.cuenta_id
    WHERE h.cuenta_id = $1
    ORDER BY h.creada_at DESC
    LIMIT 50
    `,
    [
      id
    ]
  )

  return {
    account: result.rows[0],
    history: history.rows
  }
}

async function listPortfolioOrigins({
  pool,
  usuario
}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new CarteraReadError(
      'CARTERA_POOL_INVALID',
      'La conexión de datos no es válida',
      500
    )
  }

  const scope = resolveAccessScope(usuario)
  const result = await pool.query(
    `
    SELECT
      o.id,
      o.codigo,
      o.nombre,
      o.tipo,
      o.descripcion,
      COUNT(i.id) FILTER (
        WHERE i.activo = TRUE
      )::INTEGER AS integraciones_activas
    FROM public.crm_origenes o
    LEFT JOIN public.crm_integraciones i
      ON i.origen_id = o.id
      AND i.empresa_id = o.empresa_id
    WHERE
      o.empresa_id = $1
      AND o.activo = TRUE
    GROUP BY
      o.id,
      o.codigo,
      o.nombre,
      o.tipo,
      o.descripcion
    ORDER BY
      o.nombre,
      o.id
    `,
    [
      scope.empresaId
    ]
  )

  return result.rows
}

async function listPortfolioExecutives({
  pool,
  usuario
}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new CarteraReadError(
      'CARTERA_POOL_INVALID',
      'La conexión de datos no es válida',
      500
    )
  }

  const scope = resolveAccessScope(usuario)

  const result = await pool.query(
    `
    SELECT
      id,
      nombre
    FROM public.usuarios
    WHERE
      empresa_id = $1
      AND rol = $2
      AND activo = TRUE
    ORDER BY
      nombre,
      id
    `,
    [
      scope.empresaId,
      ROLES.EJECUTIVO
    ]
  )

  return result.rows
}

module.exports = {
  CarteraReadError,
  buildListStatement,
  buildManagementListStatement,
  buildSummaryStatement,
  getPortfolioAccount,
  getPortfolioSummary,
  isValidIsoDate,
  listPortfolioExecutives,
  listPortfolioManagements,
  listPortfolioOrigins,
  listPortfolio,
  normalizeBigintId,
  normalizeListFilters,
  normalizeManagementFilters,
  normalizeOptionalBigintId,
  resolveAccessScope,
  resolvePortfolioOrigin
}
