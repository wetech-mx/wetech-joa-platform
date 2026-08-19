const {
  CARTERA_ESTADOS,
  ROLES
} = require('../config/constants')

const {
  normalizeBigintId,
  resolveAccessScope
} = require('./cartera-read-repository')

const ALLOWED_STATES = new Set(
  Object.values(CARTERA_ESTADOS)
)

const MANAGEMENT_CHANNELS = new Set([
  'telefono',
  'whatsapp',
  'correo',
  'sms',
  'visita',
  'otro'
])

const MANAGEMENT_RELATIONSHIPS = new Set([
  'titular',
  'familiar',
  'referencia',
  'tercero',
  'sin_contacto'
])

class CarteraManagementError extends Error {
  constructor(
    code,
    message,
    status = 400
  ) {
    super(message)
    this.name = 'CarteraManagementError'
    this.code = code
    this.status = status
  }
}

function normalizeRequiredText(
  value,
  {
    field,
    maximum,
    minimum = 1
  }
) {
  const text = String(value ?? '').trim()

  if (text.length < minimum) {
    throw new CarteraManagementError(
      'CARTERA_TEXT_REQUIRED',
      `${field} es obligatorio`
    )
  }

  if (text.length > maximum) {
    throw new CarteraManagementError(
      'CARTERA_TEXT_TOO_LONG',
      `${field} excede la longitud permitida`
    )
  }

  return text
}

function normalizeOptionalText(
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
    throw new CarteraManagementError(
      'CARTERA_TEXT_TOO_LONG',
      `${field} excede la longitud permitida`
    )
  }

  return text
}

function normalizeUserId(
  value,
  field = 'usuario_id'
) {
  const text = String(value ?? '').trim()

  if (!/^[1-9]\d*$/.test(text)) {
    throw new CarteraManagementError(
      'CARTERA_USER_ID_INVALID',
      `${field} no es válido`
    )
  }

  const number = Number(text)

  if (!Number.isSafeInteger(number)) {
    throw new CarteraManagementError(
      'CARTERA_USER_ID_INVALID',
      `${field} está fuera del rango permitido`
    )
  }

  return number
}

function normalizeState(value) {
  const state = String(value ?? '')
    .trim()
    .toLowerCase()

  if (!ALLOWED_STATES.has(state)) {
    throw new CarteraManagementError(
      'CARTERA_STATE_INVALID',
      'El estado de gestión no es válido'
    )
  }

  return state
}

function normalizeEnum(
  value,
  {
    allowed,
    code,
    message
  }
) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()

  if (!allowed.has(normalized)) {
    throw new CarteraManagementError(
      code,
      message
    )
  }

  return normalized
}

function normalizeExternalCode(value) {
  const code = normalizeOptionalText(
    value,
    {
      field: 'código de resultado',
      maximum: 30
    }
  )

  if (!code) {
    return null
  }

  const normalized = code.toUpperCase()

  if (!/^[A-Z0-9][A-Z0-9_-]{0,29}$/.test(normalized)) {
    throw new CarteraManagementError(
      'CARTERA_MANAGEMENT_CODE_INVALID',
      'El código de resultado no es válido'
    )
  }

  return normalized
}

function normalizeMoney(value) {
  const text = String(value ?? '').trim()

  if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(text)) {
    throw new CarteraManagementError(
      'CARTERA_PROMISE_AMOUNT_INVALID',
      'El monto de la promesa no es válido'
    )
  }

  const [integer, decimals = ''] = text.split('.')
  const normalized = `${integer}.${decimals.padEnd(2, '0')}`

  if (normalized === '0.00') {
    throw new CarteraManagementError(
      'CARTERA_PROMISE_AMOUNT_INVALID',
      'El monto de la promesa debe ser mayor a cero'
    )
  }

  return normalized
}

function normalizeIsoDate(value, field) {
  const text = String(value ?? '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)

  if (!match) {
    throw new CarteraManagementError(
      'CARTERA_DATE_INVALID',
      `${field} no es una fecha válida`
    )
  }

  const date = new Date(`${text}T00:00:00.000Z`)

  if (
    Number.isNaN(date.getTime())
    || date.toISOString().slice(0, 10) !== text
  ) {
    throw new CarteraManagementError(
      'CARTERA_DATE_INVALID',
      `${field} no es una fecha válida`
    )
  }

  return text
}

function mexicoDate(now) {
  const parts = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  ).formatToParts(now)

  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  )

  return `${values.year}-${values.month}-${values.day}`
}

function normalizeFutureDateTime(value, now) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const date = new Date(value)

  if (
    Number.isNaN(date.getTime())
    || date.getTime() <= now.getTime()
  ) {
    throw new CarteraManagementError(
      'CARTERA_FOLLOW_UP_INVALID',
      'El próximo seguimiento debe ser una fecha futura'
    )
  }

  return date.toISOString()
}

function normalizeTypification(row) {
  if (
    !row
    || !ALLOWED_STATES.has(row.estado_resultante)
    || !/^[a-z0-9][a-z0-9_]{0,99}$/.test(
      String(row.codigo ?? '')
    )
    || !String(row.nombre ?? '').trim()
    || String(row.nombre).trim().length > 150
    || !Number.isInteger(Number(row.prioridad))
    || Number(row.prioridad) < 1
    || Number(row.prioridad) > 4
  ) {
    throw new CarteraManagementError(
      'CARTERA_TYPIFICATION_INVALID',
      'La tipificación configurada no es válida',
      500
    )
  }

  return {
    id: normalizeBigintId(row.id, 'tipificacion_id'),
    code: row.codigo,
    name: String(row.nombre).trim(),
    priority: Number(row.prioridad),
    state: row.estado_resultante,
    requiresPromise: row.requiere_promesa === true,
    requiresFollowUp: row.requiere_seguimiento === true,
    closesAccount: row.cierra_cuenta === true
  }
}

function normalizePortfolioManagement(
  input = {},
  typificationRow,
  now = new Date()
) {
  const typification = normalizeTypification(
    typificationRow
  )
  const channel = normalizeEnum(
    input.canal,
    {
      allowed: MANAGEMENT_CHANNELS,
      code: 'CARTERA_MANAGEMENT_CHANNEL_INVALID',
      message: 'El canal de contacto no es válido'
    }
  )
  const relationship = normalizeEnum(
    input.relacion_contacto,
    {
      allowed: MANAGEMENT_RELATIONSHIPS,
      code: 'CARTERA_MANAGEMENT_RELATIONSHIP_INVALID',
      message: 'La relación de contacto no es válida'
    }
  )
  const phone = normalizeOptionalText(
    input.telefono_contactado,
    {
      field: 'teléfono contactado',
      maximum: 100
    }
  )

  if (
    ['telefono', 'whatsapp', 'sms'].includes(channel)
    && !phone
  ) {
    throw new CarteraManagementError(
      'CARTERA_MANAGEMENT_PHONE_REQUIRED',
      'El teléfono utilizado es obligatorio para ese canal'
    )
  }

  const notes = normalizeOptionalText(
    input.notas,
    {
      field: 'notas',
      maximum: 2000
    }
  )
  const evidence = normalizeOptionalText(
    input.evidencia,
    {
      field: 'evidencia',
      maximum: 1000
    }
  )

  if (!notes && !evidence) {
    throw new CarteraManagementError(
      'CARTERA_MANAGEMENT_CONTENT_REQUIRED',
      'Debe registrar una nota o referencia de evidencia'
    )
  }

  let promiseAmount = null
  let promiseDate = null

  if (typification.requiresPromise) {
    promiseAmount = normalizeMoney(input.promesa_monto)
    promiseDate = normalizeIsoDate(
      input.promesa_fecha,
      'La fecha de promesa'
    )

    if (promiseDate < mexicoDate(now)) {
      throw new CarteraManagementError(
        'CARTERA_PROMISE_DATE_PAST',
        'La fecha de promesa no puede estar vencida'
      )
    }
  } else if (
    input.promesa_monto
    || input.promesa_fecha
  ) {
    throw new CarteraManagementError(
      'CARTERA_PROMISE_UNEXPECTED',
      'La tipificación seleccionada no permite registrar una promesa'
    )
  }

  const nextFollowUp = normalizeFutureDateTime(
    input.proximo_seguimiento_at,
    now
  )

  if (typification.requiresFollowUp && !nextFollowUp) {
    throw new CarteraManagementError(
      'CARTERA_FOLLOW_UP_REQUIRED',
      'La tipificación requiere programar un próximo seguimiento'
    )
  }

  return {
    typification,
    externalCode: normalizeExternalCode(
      input.codigo_resultado
    ),
    channel,
    phone,
    contactedPerson: normalizeOptionalText(
      input.persona_contactada,
      {
        field: 'persona contactada',
        maximum: 200
      }
    ),
    relationship,
    promiseAmount,
    promiseDate,
    nextFollowUp,
    notes,
    evidence
  }
}

function resolveActor(usuario = {}) {
  const scope = resolveAccessScope(usuario)
  const actorId = normalizeUserId(
    usuario.id,
    'usuario_id'
  )

  return {
    ...scope,
    actorId,
    isAdministrator: (
      usuario.rol === ROLES.ADMIN
      || usuario.rol === ROLES.SUPER_ADMIN
    )
  }
}

async function listPortfolioTypifications({
  pool,
  usuario
}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new CarteraManagementError(
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
      codigo,
      nombre,
      prioridad,
      estado_resultante,
      contacto_efectivo,
      requiere_promesa,
      requiere_seguimiento,
      cierra_cuenta,
      orden
    FROM public.cartera_tipificaciones
    WHERE
      empresa_id = $1
      AND activa = TRUE
    ORDER BY
      prioridad,
      orden,
      nombre,
      id
    `,
    [scope.empresaId]
  )

  return {
    data: result.rows
  }
}

function validatePool(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new CarteraManagementError(
      'CARTERA_POOL_INVALID',
      'La conexión de datos no es válida',
      500
    )
  }
}

async function withTransaction(
  pool,
  callback
) {
  validatePool(pool)

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const result = await callback(client)

    await client.query('COMMIT')

    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // El error original conserva la prioridad.
    }

    throw error
  } finally {
    client.release()
  }
}

async function lockAccessibleAccount(
  client,
  {
    accountId,
    actor
  }
) {
  const values = [
    accountId,
    actor.empresaId
  ]
  let assignmentCondition = ''

  if (actor.isExecutive) {
    values.push(actor.actorId)
    assignmentCondition = `
      AND EXISTS (
        SELECT 1
        FROM public.cartera_asignaciones ca
        WHERE
          ca.cuenta_id = c.id
          AND ca.usuario_id = $3
          AND ca.activa = TRUE
      )
    `
  }

  const result = await client.query(
    `
    SELECT
      c.id,
      c.estado_gestion
    FROM public.cartera_cuentas c
    WHERE
      c.id = $1
      AND c.empresa_id = $2
      ${assignmentCondition}
    FOR UPDATE
    `,
    values
  )

  if (!result.rows[0]) {
    throw new CarteraManagementError(
      'CARTERA_ACCOUNT_NOT_FOUND',
      'La cuenta no existe o no pertenece al alcance',
      404
    )
  }

  return result.rows[0]
}

async function addPortfolioNote({
  pool,
  usuario,
  accountId,
  note
}) {
  const id = normalizeBigintId(
    accountId,
    'id'
  )
  const actor = resolveActor(usuario)
  const normalizedNote = normalizeRequiredText(
    note,
    {
      field: 'nota',
      maximum: 2000
    }
  )

  return withTransaction(
    pool,
    async client => {
      await lockAccessibleAccount(
        client,
        {
          accountId: id,
          actor
        }
      )

      const result = await client.query(
        `
        INSERT INTO public.cartera_historial
        (
          cuenta_id,
          usuario_id,
          evento,
          detalle
        )
        VALUES
        (
          $1,
          $2,
          'nota_agregada',
          $3
        )
        RETURNING
          id,
          cuenta_id,
          usuario_id,
          evento,
          detalle,
          creada_at
        `,
        [
          id,
          actor.actorId,
          normalizedNote
        ]
      )

      return {
        note: result.rows[0]
      }
    }
  )
}

async function updatePortfolioState({
  pool,
  usuario,
  accountId,
  state,
  detail
}) {
  const id = normalizeBigintId(
    accountId,
    'id'
  )
  const actor = resolveActor(usuario)
  const normalizedState = normalizeState(state)
  const normalizedDetail = normalizeOptionalText(
    detail,
    {
      field: 'detalle',
      maximum: 1000
    }
  )

  return withTransaction(
    pool,
    async client => {
      const account = await lockAccessibleAccount(
        client,
        {
          accountId: id,
          actor
        }
      )

      if (
        account.estado_gestion
        === normalizedState
      ) {
        return {
          changed: false,
          account: {
            id: account.id,
            estado_gestion:
              account.estado_gestion
          }
        }
      }

      const updated = await client.query(
        `
        UPDATE public.cartera_cuentas
        SET
          estado_gestion = $2,
          actualizada_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          estado_gestion,
          actualizada_at
        `,
        [
          id,
          normalizedState
        ]
      )

      const history = await client.query(
        `
        INSERT INTO public.cartera_historial
        (
          cuenta_id,
          usuario_id,
          evento,
          detalle,
          valor_anterior,
          valor_nuevo
        )
        VALUES
        (
          $1,
          $2,
          'estado_actualizado',
          $3,
          $4::JSONB,
          $5::JSONB
        )
        RETURNING id
        `,
        [
          id,
          actor.actorId,
          normalizedDetail,
          JSON.stringify({
            estado: account.estado_gestion
          }),
          JSON.stringify({
            estado: normalizedState
          })
        ]
      )

      return {
        changed: true,
        account: updated.rows[0],
        historyId: history.rows[0].id
      }
    }
  )
}

async function reassignPortfolioAccount({
  pool,
  usuario,
  accountId,
  executiveId,
  reason
}) {
  const id = normalizeBigintId(
    accountId,
    'id'
  )
  const actor = resolveActor(usuario)

  if (!actor.isAdministrator) {
    throw new CarteraManagementError(
      'CARTERA_REASSIGN_FORBIDDEN',
      'Solo un administrador puede reasignar cuentas',
      403
    )
  }

  const normalizedExecutiveId = normalizeUserId(
    executiveId,
    'ejecutivo_id'
  )
  const normalizedReason = normalizeRequiredText(
    reason,
    {
      field: 'motivo',
      minimum: 5,
      maximum: 1000
    }
  )

  return withTransaction(
    pool,
    async client => {
      await lockAccessibleAccount(
        client,
        {
          accountId: id,
          actor
        }
      )

      const executive = await client.query(
        `
        SELECT id
        FROM public.usuarios
        WHERE
          id = $1
          AND empresa_id = $2
          AND rol = $3
          AND activo = TRUE
        FOR SHARE
        `,
        [
          normalizedExecutiveId,
          actor.empresaId,
          ROLES.EJECUTIVO
        ]
      )

      if (!executive.rows[0]) {
        throw new CarteraManagementError(
          'CARTERA_EXECUTIVE_INVALID',
          'El nuevo ejecutivo no está activo en la empresa',
          400
        )
      }

      const current = await client.query(
        `
        SELECT
          id,
          usuario_id
        FROM public.cartera_asignaciones
        WHERE
          cuenta_id = $1
          AND activa = TRUE
        FOR UPDATE
        `,
        [
          id
        ]
      )

      const currentAssignment =
        current.rows[0] || null

      if (
        currentAssignment
        && Number(currentAssignment.usuario_id)
          === normalizedExecutiveId
      ) {
        throw new CarteraManagementError(
          'CARTERA_EXECUTIVE_UNCHANGED',
          'La cuenta ya está asignada a ese ejecutivo',
          409
        )
      }

      if (currentAssignment) {
        await client.query(
          `
          UPDATE public.cartera_asignaciones
          SET
            activa = FALSE,
            finalizada_at = NOW()
          WHERE id = $1
          `,
          [
            currentAssignment.id
          ]
        )
      }

      const method = currentAssignment
        ? 'reasignacion'
        : 'manual'

      const created = await client.query(
        `
        INSERT INTO public.cartera_asignaciones
        (
          cuenta_id,
          usuario_id,
          asignado_por,
          metodo,
          motivo
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5
        )
        RETURNING
          id,
          cuenta_id,
          usuario_id,
          asignado_por,
          metodo,
          motivo,
          activa,
          asignada_at
        `,
        [
          id,
          normalizedExecutiveId,
          actor.actorId,
          method,
          normalizedReason
        ]
      )

      const assignment = created.rows[0]

      await client.query(
        `
        INSERT INTO public.cartera_historial
        (
          cuenta_id,
          asignacion_id,
          usuario_id,
          evento,
          detalle,
          valor_anterior,
          valor_nuevo
        )
        VALUES
        (
          $1,
          $2,
          $3,
          'cuenta_reasignada',
          $4,
          $5::JSONB,
          $6::JSONB
        )
        `,
        [
          id,
          assignment.id,
          actor.actorId,
          normalizedReason,
          JSON.stringify({
            ejecutivo_id:
              currentAssignment?.usuario_id
              ?? null
          }),
          JSON.stringify({
            ejecutivo_id:
              normalizedExecutiveId
          })
        ]
      )

      return {
        assignment
      }
    }
  )
}

async function registerPortfolioManagement({
  pool,
  usuario,
  accountId,
  input,
  now = new Date()
}) {
  const id = normalizeBigintId(accountId, 'id')
  const actor = resolveActor(usuario)
  const typificationId = normalizeBigintId(
    input?.tipificacion_id,
    'tipificacion_id'
  )

  return withTransaction(
    pool,
    async client => {
      const account = await lockAccessibleAccount(
        client,
        {
          accountId: id,
          actor
        }
      )

      const configured = await client.query(
        `
        SELECT
          id,
          codigo,
          nombre,
          prioridad,
          estado_resultante,
          requiere_promesa,
          requiere_seguimiento,
          cierra_cuenta
        FROM public.cartera_tipificaciones
        WHERE
          id = $1
          AND empresa_id = $2
          AND activa = TRUE
        FOR SHARE
        `,
        [typificationId, actor.empresaId]
      )

      if (!configured.rows[0]) {
        throw new CarteraManagementError(
          'CARTERA_TYPIFICATION_NOT_FOUND',
          'La tipificación no existe o está inactiva',
          404
        )
      }

      const management = normalizePortfolioManagement(
        input,
        configured.rows[0],
        now
      )

      if (
        account.estado_gestion
        !== management.typification.state
      ) {
        await client.query(
          `
          UPDATE public.cartera_cuentas
          SET
            estado_gestion = $2,
            actualizada_at = NOW()
          WHERE id = $1
          `,
          [id, management.typification.state]
        )
      }

      const created = await client.query(
        `
        INSERT INTO public.cartera_gestiones
        (
          empresa_id,
          cuenta_id,
          tipificacion_id,
          usuario_id,
          tipificacion_codigo,
          tipificacion_nombre,
          prioridad,
          estado_resultante,
          codigo_resultado,
          canal,
          telefono_contactado,
          persona_contactada,
          relacion_contacto,
          promesa_monto,
          promesa_fecha,
          promesa_estado,
          proximo_seguimiento_at,
          seguimiento_estado,
          notas,
          evidencia
        )
        VALUES
        (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20
        )
        RETURNING
          id,
          empresa_id,
          cuenta_id,
          tipificacion_id,
          usuario_id,
          tipificacion_codigo,
          tipificacion_nombre,
          prioridad,
          estado_resultante,
          codigo_resultado,
          canal,
          telefono_contactado,
          persona_contactada,
          relacion_contacto,
          promesa_monto,
          promesa_fecha,
          promesa_estado,
          proximo_seguimiento_at,
          seguimiento_estado,
          notas,
          evidencia,
          creada_at
        `,
        [
          actor.empresaId,
          id,
          management.typification.id,
          actor.actorId,
          management.typification.code,
          management.typification.name,
          management.typification.priority,
          management.typification.state,
          management.externalCode,
          management.channel,
          management.phone,
          management.contactedPerson,
          management.relationship,
          management.promiseAmount,
          management.promiseDate,
          management.promiseAmount ? 'pendiente' : null,
          management.nextFollowUp,
          management.nextFollowUp ? 'pendiente' : null,
          management.notes,
          management.evidence
        ]
      )

      const record = created.rows[0]

      await client.query(
        `
        INSERT INTO public.cartera_historial
        (
          cuenta_id,
          gestion_id,
          usuario_id,
          evento,
          detalle,
          valor_anterior,
          valor_nuevo
        )
        VALUES
        (
          $1,
          $2,
          $3,
          'gestion_registrada',
          $4,
          $5::JSONB,
          $6::JSONB
        )
        `,
        [
          id,
          record.id,
          actor.actorId,
          management.notes,
          JSON.stringify({
            estado: account.estado_gestion
          }),
          JSON.stringify({
            estado: management.typification.state,
            tipificacion: management.typification.code,
            tipificacion_nombre: management.typification.name,
            prioridad: management.typification.priority,
            codigo_resultado: management.externalCode,
            promesa_monto: management.promiseAmount,
            promesa_fecha: management.promiseDate,
            proximo_seguimiento_at:
              management.nextFollowUp
          })
        ]
      )

      return {
        management: record,
        account: {
          id,
          estado_gestion: management.typification.state
        }
      }
    }
  )
}

module.exports = {
  ALLOWED_STATES,
  CarteraManagementError,
  MANAGEMENT_CHANNELS,
  MANAGEMENT_RELATIONSHIPS,
  addPortfolioNote,
  listPortfolioTypifications,
  lockAccessibleAccount,
  normalizeRequiredText,
  normalizePortfolioManagement,
  normalizeTypification,
  normalizeState,
  normalizeUserId,
  reassignPortfolioAccount,
  registerPortfolioManagement,
  resolveActor,
  updatePortfolioState,
  withTransaction
}
