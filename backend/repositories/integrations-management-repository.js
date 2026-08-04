const ORIGIN_TYPES = new Set([
  'cliente_cobranza',
  'sistema_interno',
  'otro'
])

const DIRECTIONS = new Set([
  'entrada',
  'salida',
  'bidireccional'
])

const EXECUTION_MODES = new Set([
  'manual',
  'programada',
  'evento'
])

const FORBIDDEN_CONFIG_KEY = /(?:password|passwd|contrasena|contraseña|token|secret|secreto|credential|credencial|private[_-]?key|api[_-]?key|llave|authorization|connection[_-]?string|cadena[_-]?conexion)/i
const FORBIDDEN_CONFIG_VALUE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]+|(?:postgres(?:ql)?|mysql|mssql):\/\/[^\s:@/]+:[^\s@/]+@)/i

class IntegrationAdminError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'IntegrationAdminError'
    this.code = code
    this.status = status
  }
}

function normalizeBigintId(value, field = 'id') {
  const text = String(value ?? '').trim()

  if (!/^[1-9]\d{0,18}$/.test(text)) {
    throw new IntegrationAdminError(
      'INTEGRATION_ID_INVALID',
      `El campo ${field} no contiene un identificador válido`
    )
  }

  const number = BigInt(text)

  if (number > 9223372036854775807n) {
    throw new IntegrationAdminError(
      'INTEGRATION_ID_INVALID',
      `El campo ${field} excede el rango permitido`
    )
  }

  return text
}

function normalizeCompanyId(usuario) {
  const companyId = Number(usuario?.empresa_id)

  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new IntegrationAdminError(
      'INTEGRATION_COMPANY_REQUIRED',
      'La sesión no contiene una empresa válida',
      403
    )
  }

  return companyId
}

function normalizeRequiredText(value, field, maxLength) {
  const text = String(value ?? '').trim()

  if (!text) {
    throw new IntegrationAdminError(
      'INTEGRATION_FIELD_REQUIRED',
      `El campo ${field} es obligatorio`
    )
  }

  if (text.length > maxLength) {
    throw new IntegrationAdminError(
      'INTEGRATION_FIELD_TOO_LONG',
      `El campo ${field} excede ${maxLength} caracteres`
    )
  }

  return text
}

function normalizeOptionalText(value, field, maxLength) {
  if (value === undefined || value === null) {
    return null
  }

  const text = String(value).trim()

  if (!text) {
    return null
  }

  if (text.length > maxLength) {
    throw new IntegrationAdminError(
      'INTEGRATION_FIELD_TOO_LONG',
      `El campo ${field} excede ${maxLength} caracteres`
    )
  }

  return text
}

function normalizeCode(value, field = 'codigo') {
  const code = normalizeRequiredText(value, field, 100)

  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(code)) {
    throw new IntegrationAdminError(
      'INTEGRATION_CODE_INVALID',
      `El campo ${field} debe usar minúsculas, números y guion bajo`
    )
  }

  return code
}

function normalizeBoolean(value, field) {
  if (typeof value !== 'boolean') {
    throw new IntegrationAdminError(
      'INTEGRATION_BOOLEAN_INVALID',
      `El campo ${field} debe ser booleano`
    )
  }

  return value
}

function assertSafeConfiguration(value, path = 'configuracion_no_secreta') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertSafeConfiguration(entry, `${path}[${index}]`)
    })
    return
  }

  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_CONFIG_KEY.test(key)) {
        throw new IntegrationAdminError(
          'INTEGRATION_SECRET_FORBIDDEN',
          `El campo ${path}.${key} puede contener un secreto y no está permitido`
        )
      }

      assertSafeConfiguration(entry, `${path}.${key}`)
    }
    return
  }

  if (
    typeof value === 'string'
    && FORBIDDEN_CONFIG_VALUE.test(value)
  ) {
    throw new IntegrationAdminError(
      'INTEGRATION_SECRET_FORBIDDEN',
      `El campo ${path} contiene un valor sensible no permitido`
    )
  }
}

function normalizeJsonObject(value, field) {
  if (
    value === undefined
    || value === null
  ) {
    return {}
  }

  if (
    typeof value !== 'object'
    || Array.isArray(value)
  ) {
    throw new IntegrationAdminError(
      'INTEGRATION_JSON_INVALID',
      `El campo ${field} debe ser un objeto JSON`
    )
  }

  assertSafeConfiguration(value, field)

  const serialized = JSON.stringify(value)

  if (Buffer.byteLength(serialized, 'utf8') > 16384) {
    throw new IntegrationAdminError(
      'INTEGRATION_JSON_TOO_LARGE',
      `El campo ${field} excede 16 KB`
    )
  }

  return value
}

function rejectSecretFields(body) {
  const forbidden = [
    'referencia_secreto',
    'secret_reference',
    'password',
    'token',
    'api_key',
    'private_key'
  ]

  for (const field of forbidden) {
    if (Object.hasOwn(body || {}, field)) {
      throw new IntegrationAdminError(
        'INTEGRATION_SECRET_FORBIDDEN',
        'Las credenciales se administran solamente en el servidor'
      )
    }
  }
}

function normalizeOriginInput(body, current = null) {
  const source = body || {}
  const merged = current
    ? {
        ...current,
        ...source
      }
    : source

  const type = normalizeRequiredText(
    merged.tipo,
    'tipo',
    30
  )

  if (!ORIGIN_TYPES.has(type)) {
    throw new IntegrationAdminError(
      'INTEGRATION_ORIGIN_TYPE_INVALID',
      'El tipo de origen no es válido'
    )
  }

  return {
    code: normalizeCode(merged.codigo),
    name: normalizeRequiredText(
      merged.nombre,
      'nombre',
      255
    ),
    type,
    description: normalizeOptionalText(
      merged.descripcion,
      'descripcion',
      2000
    ),
    metadata: normalizeJsonObject(
      merged.metadatos,
      'metadatos'
    ),
    active: merged.activo === undefined
      ? true
      : normalizeBoolean(merged.activo, 'activo')
  }
}

function normalizeIntegrationInput(body, current = null) {
  rejectSecretFields(body)

  const source = body || {}
  const merged = current
    ? {
        ...current,
        ...source
      }
    : source

  const direction = normalizeRequiredText(
    merged.direccion ?? 'entrada',
    'direccion',
    20
  )
  const executionMode = normalizeRequiredText(
    merged.modo_ejecucion ?? 'manual',
    'modo_ejecucion',
    20
  )

  if (!DIRECTIONS.has(direction)) {
    throw new IntegrationAdminError(
      'INTEGRATION_DIRECTION_INVALID',
      'La dirección de la integración no es válida'
    )
  }

  if (!EXECUTION_MODES.has(executionMode)) {
    throw new IntegrationAdminError(
      'INTEGRATION_EXECUTION_MODE_INVALID',
      'El modo de ejecución no es válido'
    )
  }

  return {
    typeCode: normalizeRequiredText(
      merged.tipo_codigo,
      'tipo_codigo',
      50
    ),
    code: normalizeCode(merged.codigo),
    name: normalizeRequiredText(
      merged.nombre,
      'nombre',
      255
    ),
    product: normalizeOptionalText(
      merged.producto,
      'producto',
      100
    ),
    adapter: normalizeRequiredText(
      merged.adaptador,
      'adaptador',
      100
    ),
    direction,
    executionMode,
    configuration: normalizeJsonObject(
      merged.configuracion_no_secreta,
      'configuracion_no_secreta'
    ),
    active: merged.activo === undefined
      ? true
      : normalizeBoolean(merged.activo, 'activo')
  }
}

function translateDatabaseError(error) {
  if (error?.code === '23505') {
    throw new IntegrationAdminError(
      'INTEGRATION_CODE_CONFLICT',
      'Ya existe un registro con ese código dentro de la empresa',
      409
    )
  }

  if (error?.code === '23503') {
    throw new IntegrationAdminError(
      'INTEGRATION_REFERENCE_INVALID',
      'El origen o tipo de integración no es válido'
    )
  }

  throw error
}

async function listIntegrationTypes({ pool, usuario }) {
  normalizeCompanyId(usuario)

  const result = await pool.query(`
    SELECT
      codigo,
      nombre,
      categoria,
      descripcion
    FROM public.crm_tipos_integracion
    WHERE activo = TRUE
    ORDER BY categoria, nombre
  `)

  return result.rows
}

async function listOrigins({ pool, usuario }) {
  const companyId = normalizeCompanyId(usuario)
  const result = await pool.query(
    `
    SELECT
      o.id::TEXT AS id,
      o.codigo,
      o.nombre,
      o.tipo,
      o.descripcion,
      o.metadatos,
      o.activo,
      o.creado_at,
      o.actualizado_at,
      COUNT(i.id)::INTEGER AS integraciones,
      COUNT(i.id) FILTER (
        WHERE i.activo = TRUE
      )::INTEGER AS integraciones_activas
    FROM public.crm_origenes o
    LEFT JOIN public.crm_integraciones i
      ON i.empresa_id = o.empresa_id
      AND i.origen_id = o.id
    WHERE o.empresa_id = $1
    GROUP BY o.id
    ORDER BY o.nombre, o.id
    `,
    [companyId]
  )

  return result.rows
}

async function findOrigin(pool, companyId, originId) {
  const result = await pool.query(
    `
    SELECT
      id::TEXT AS id,
      codigo,
      nombre,
      tipo,
      descripcion,
      metadatos,
      activo
    FROM public.crm_origenes
    WHERE empresa_id = $1
      AND id = $2::BIGINT
    `,
    [companyId, originId]
  )

  if (!result.rows[0]) {
    throw new IntegrationAdminError(
      'INTEGRATION_ORIGIN_NOT_FOUND',
      'El origen no existe dentro de la empresa',
      404
    )
  }

  return result.rows[0]
}

async function createOrigin({ pool, usuario, body }) {
  const companyId = normalizeCompanyId(usuario)
  const input = normalizeOriginInput(body)

  try {
    const result = await pool.query(
      `
      INSERT INTO public.crm_origenes
      (
        empresa_id,
        codigo,
        nombre,
        tipo,
        descripcion,
        metadatos,
        activo
      )
      VALUES ($1, $2, $3, $4, $5, $6::JSONB, $7)
      RETURNING
        id::TEXT AS id,
        codigo,
        nombre,
        tipo,
        descripcion,
        metadatos,
        activo,
        creado_at,
        actualizado_at
      `,
      [
        companyId,
        input.code,
        input.name,
        input.type,
        input.description,
        JSON.stringify(input.metadata),
        input.active
      ]
    )

    return result.rows[0]
  } catch (error) {
    return translateDatabaseError(error)
  }
}

async function updateOrigin({
  pool,
  usuario,
  originId,
  body
}) {
  const companyId = normalizeCompanyId(usuario)
  const id = normalizeBigintId(originId, 'origen_id')
  const current = await findOrigin(pool, companyId, id)
  const input = normalizeOriginInput(body, current)

  try {
    const result = await pool.query(
      `
      UPDATE public.crm_origenes
      SET
        codigo = $3,
        nombre = $4,
        tipo = $5,
        descripcion = $6,
        metadatos = $7::JSONB,
        activo = $8,
        actualizado_at = NOW()
      WHERE empresa_id = $1
        AND id = $2::BIGINT
      RETURNING
        id::TEXT AS id,
        codigo,
        nombre,
        tipo,
        descripcion,
        metadatos,
        activo,
        creado_at,
        actualizado_at
      `,
      [
        companyId,
        id,
        input.code,
        input.name,
        input.type,
        input.description,
        JSON.stringify(input.metadata),
        input.active
      ]
    )

    return result.rows[0]
  } catch (error) {
    return translateDatabaseError(error)
  }
}

async function listIntegrations({
  pool,
  usuario,
  originId
}) {
  const companyId = normalizeCompanyId(usuario)
  const values = [companyId]
  let originFilter = ''

  if (originId !== undefined) {
    const id = normalizeBigintId(originId, 'origen_id')
    values.push(id)
    originFilter = 'AND i.origen_id = $2::BIGINT'
  }

  const result = await pool.query(
    `
    SELECT
      i.id::TEXT AS id,
      i.origen_id::TEXT AS origen_id,
      o.codigo AS origen_codigo,
      o.nombre AS origen_nombre,
      i.tipo_codigo,
      t.nombre AS tipo_nombre,
      t.categoria,
      i.codigo,
      i.nombre,
      i.producto,
      i.adaptador,
      i.direccion,
      i.modo_ejecucion,
      i.configuracion_no_secreta,
      (i.referencia_secreto IS NOT NULL)
        AS secreto_configurado,
      i.activo,
      i.ultima_ejecucion_at,
      i.ultimo_estado,
      i.ultimo_error_codigo,
      i.creado_at,
      i.actualizado_at
    FROM public.crm_integraciones i
    INNER JOIN public.crm_origenes o
      ON o.empresa_id = i.empresa_id
      AND o.id = i.origen_id
    INNER JOIN public.crm_tipos_integracion t
      ON t.codigo = i.tipo_codigo
    WHERE i.empresa_id = $1
      ${originFilter}
    ORDER BY o.nombre, i.nombre, i.id
    `,
    values
  )

  return result.rows
}

async function assertActiveType(pool, typeCode) {
  const result = await pool.query(
    `
    SELECT codigo
    FROM public.crm_tipos_integracion
    WHERE codigo = $1
      AND activo = TRUE
    `,
    [typeCode]
  )

  if (!result.rows[0]) {
    throw new IntegrationAdminError(
      'INTEGRATION_TYPE_NOT_FOUND',
      'El tipo de integración no existe o está inactivo',
      404
    )
  }
}

async function createIntegration({
  pool,
  usuario,
  originId,
  body
}) {
  const companyId = normalizeCompanyId(usuario)
  const id = normalizeBigintId(originId, 'origen_id')
  const input = normalizeIntegrationInput(body)

  await findOrigin(pool, companyId, id)
  await assertActiveType(pool, input.typeCode)

  try {
    const result = await pool.query(
      `
      INSERT INTO public.crm_integraciones
      (
        empresa_id,
        origen_id,
        tipo_codigo,
        codigo,
        nombre,
        producto,
        adaptador,
        direccion,
        modo_ejecucion,
        configuracion_no_secreta,
        activo
      )
      VALUES (
        $1,
        $2::BIGINT,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10::JSONB,
        $11
      )
      RETURNING
        id::TEXT AS id,
        origen_id::TEXT AS origen_id,
        tipo_codigo,
        codigo,
        nombre,
        producto,
        adaptador,
        direccion,
        modo_ejecucion,
        configuracion_no_secreta,
        FALSE AS secreto_configurado,
        activo,
        creado_at,
        actualizado_at
      `,
      [
        companyId,
        id,
        input.typeCode,
        input.code,
        input.name,
        input.product,
        input.adapter,
        input.direction,
        input.executionMode,
        JSON.stringify(input.configuration),
        input.active
      ]
    )

    return result.rows[0]
  } catch (error) {
    return translateDatabaseError(error)
  }
}

async function findIntegration(
  pool,
  companyId,
  integrationId
) {
  const result = await pool.query(
    `
    SELECT
      id::TEXT AS id,
      origen_id::TEXT AS origen_id,
      tipo_codigo,
      codigo,
      nombre,
      producto,
      adaptador,
      direccion,
      modo_ejecucion,
      configuracion_no_secreta,
      activo,
      (referencia_secreto IS NOT NULL)
        AS secreto_configurado
    FROM public.crm_integraciones
    WHERE empresa_id = $1
      AND id = $2::BIGINT
    `,
    [companyId, integrationId]
  )

  if (!result.rows[0]) {
    throw new IntegrationAdminError(
      'INTEGRATION_NOT_FOUND',
      'La integración no existe dentro de la empresa',
      404
    )
  }

  return result.rows[0]
}

async function updateIntegration({
  pool,
  usuario,
  integrationId,
  body
}) {
  const companyId = normalizeCompanyId(usuario)
  const id = normalizeBigintId(
    integrationId,
    'integracion_id'
  )
  const current = await findIntegration(
    pool,
    companyId,
    id
  )
  const input = normalizeIntegrationInput(body, current)
  const originId = body?.origen_id === undefined
    ? current.origen_id
    : normalizeBigintId(body.origen_id, 'origen_id')

  await findOrigin(pool, companyId, originId)
  await assertActiveType(pool, input.typeCode)

  try {
    const result = await pool.query(
      `
      UPDATE public.crm_integraciones
      SET
        origen_id = $3::BIGINT,
        tipo_codigo = $4,
        codigo = $5,
        nombre = $6,
        producto = $7,
        adaptador = $8,
        direccion = $9,
        modo_ejecucion = $10,
        configuracion_no_secreta = $11::JSONB,
        activo = $12,
        actualizado_at = NOW()
      WHERE empresa_id = $1
        AND id = $2::BIGINT
      RETURNING
        id::TEXT AS id,
        origen_id::TEXT AS origen_id,
        tipo_codigo,
        codigo,
        nombre,
        producto,
        adaptador,
        direccion,
        modo_ejecucion,
        configuracion_no_secreta,
        (referencia_secreto IS NOT NULL)
          AS secreto_configurado,
        activo,
        creado_at,
        actualizado_at
      `,
      [
        companyId,
        id,
        originId,
        input.typeCode,
        input.code,
        input.name,
        input.product,
        input.adapter,
        input.direction,
        input.executionMode,
        JSON.stringify(input.configuration),
        input.active
      ]
    )

    return result.rows[0]
  } catch (error) {
    return translateDatabaseError(error)
  }
}

module.exports = {
  IntegrationAdminError,
  assertSafeConfiguration,
  createIntegration,
  createOrigin,
  listIntegrationTypes,
  listIntegrations,
  listOrigins,
  normalizeBigintId,
  normalizeIntegrationInput,
  normalizeOriginInput,
  updateIntegration,
  updateOrigin
}
