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

module.exports = {
  ALLOWED_STATES,
  CarteraManagementError,
  addPortfolioNote,
  lockAccessibleAccount,
  normalizeRequiredText,
  normalizeState,
  normalizeUserId,
  reassignPortfolioAccount,
  resolveActor,
  updatePortfolioState,
  withTransaction
}
