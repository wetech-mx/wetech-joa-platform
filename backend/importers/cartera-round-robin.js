const EJECUTIVO_ROLE = 'Ejecutivo'

class CarteraAssignmentError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CarteraAssignmentError'
    this.code = code
  }
}

function validateAssignmentInput({
  client,
  empresaId,
  cuentaId,
  idCampania
}) {
  if (!client || typeof client.query !== 'function') {
    throw new CarteraAssignmentError(
      'BAZ_ASSIGN_CLIENT_INVALID',
      'La conexión transaccional no es válida'
    )
  }

  if (!Number.isInteger(empresaId) || empresaId <= 0) {
    throw new CarteraAssignmentError(
      'BAZ_ASSIGN_EMPRESA_INVALID',
      'empresaId debe ser un entero positivo'
    )
  }

  if (!Number.isInteger(cuentaId) || cuentaId <= 0) {
    throw new CarteraAssignmentError(
      'BAZ_ASSIGN_ACCOUNT_INVALID',
      'cuentaId debe ser un entero positivo'
    )
  }

  if (
    typeof idCampania !== 'string'
    || idCampania.trim() === ''
  ) {
    throw new CarteraAssignmentError(
      'BAZ_ASSIGN_CAMPAIGN_INVALID',
      'idCampania es obligatorio'
    )
  }
}

function chooseNextExecutive(
  executiveIds,
  lastExecutiveId
) {
  if (
    !Array.isArray(executiveIds)
    || executiveIds.length === 0
  ) {
    throw new CarteraAssignmentError(
      'BAZ_ASSIGN_NO_EXECUTIVES',
      'No existen ejecutivos activos para asignar la cartera'
    )
  }

  const lastIndex = executiveIds.indexOf(
    lastExecutiveId
  )

  if (lastIndex === -1) {
    return executiveIds[0]
  }

  return executiveIds[
    (lastIndex + 1) % executiveIds.length
  ]
}

async function lockAccount(
  client,
  cuentaId,
  empresaId
) {
  const result = await client.query(
    `
    SELECT id
    FROM public.cartera_cuentas
    WHERE
      id = $1
      AND empresa_id = $2
    FOR UPDATE
    `,
    [
      cuentaId,
      empresaId
    ]
  )

  if (!result.rows[0]) {
    throw new CarteraAssignmentError(
      'BAZ_ASSIGN_ACCOUNT_NOT_FOUND',
      'La cuenta de cartera no existe'
    )
  }
}

async function findActiveAssignment(
  client,
  cuentaId
) {
  const result = await client.query(
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
      cuentaId
    ]
  )

  return result.rows[0] || null
}

async function listActiveExecutives(
  client,
  empresaId
) {
  const result = await client.query(
    `
    SELECT id
    FROM public.usuarios
    WHERE
      empresa_id = $1
      AND activo = TRUE
      AND rol = $2
    ORDER BY id
    `,
    [
      empresaId,
      EJECUTIVO_ROLE
    ]
  )

  return result.rows.map(row => row.id)
}

async function lockRoundRobinState(
  client,
  empresaId,
  idCampania
) {
  await client.query(
    `
    INSERT INTO public.cartera_round_robin_estado
    (
      empresa_id,
      id_campania
    )
    VALUES
    (
      $1,
      $2
    )
    ON CONFLICT
    (
      empresa_id,
      id_campania
    )
    DO NOTHING
    `,
    [
      empresaId,
      idCampania
    ]
  )

  const result = await client.query(
    `
    SELECT ultimo_usuario_id
    FROM public.cartera_round_robin_estado
    WHERE
      empresa_id = $1
      AND id_campania = $2
    FOR UPDATE
    `,
    [
      empresaId,
      idCampania
    ]
  )

  if (!result.rows[0]) {
    throw new CarteraAssignmentError(
      'BAZ_ASSIGN_STATE_FAILED',
      'No fue posible bloquear el cursor round robin'
    )
  }

  return result.rows[0].ultimo_usuario_id
}

async function createAssignment(
  client,
  {
    cuentaId,
    usuarioId
  }
) {
  const result = await client.query(
    `
    INSERT INTO public.cartera_asignaciones
    (
      cuenta_id,
      usuario_id,
      metodo,
      motivo
    )
    VALUES
    (
      $1,
      $2,
      'round_robin',
      'Asignación automática de cartera'
    )
    RETURNING id
    `,
    [
      cuentaId,
      usuarioId
    ]
  )

  if (!result.rows[0]) {
    throw new CarteraAssignmentError(
      'BAZ_ASSIGN_INSERT_FAILED',
      'No fue posible crear la asignación'
    )
  }

  return result.rows[0].id
}

async function updateRoundRobinState(
  client,
  {
    empresaId,
    idCampania,
    usuarioId
  }
) {
  await client.query(
    `
    UPDATE public.cartera_round_robin_estado
    SET
      ultimo_usuario_id = $3,
      actualizada_at = NOW()
    WHERE
      empresa_id = $1
      AND id_campania = $2
    `,
    [
      empresaId,
      idCampania,
      usuarioId
    ]
  )
}

async function registerAssignmentHistory(
  client,
  {
    cuentaId,
    asignacionId,
    usuarioId
  }
) {
  await client.query(
    `
    INSERT INTO public.cartera_historial
    (
      cuenta_id,
      asignacion_id,
      evento,
      detalle,
      valor_nuevo
    )
    VALUES
    (
      $1,
      $2,
      'asignacion_round_robin',
      'Cuenta asignada automáticamente',
      $3::JSONB
    )
    `,
    [
      cuentaId,
      asignacionId,
      JSON.stringify({
        usuarioId
      })
    ]
  )
}

async function assignRoundRobin({
  client,
  empresaId,
  cuentaId,
  idCampania
}) {
  validateAssignmentInput({
    client,
    empresaId,
    cuentaId,
    idCampania
  })

  const normalizedCampaign = idCampania.trim()

  await lockAccount(
    client,
    cuentaId,
    empresaId
  )

  const existing = await findActiveAssignment(
    client,
    cuentaId
  )

  if (existing) {
    return {
      status: 'kept',
      asignacionId: existing.id,
      usuarioId: existing.usuario_id
    }
  }

  const executiveIds = await listActiveExecutives(
    client,
    empresaId
  )

  if (executiveIds.length === 0) {
    chooseNextExecutive([], null)
  }

  const lastExecutiveId = await lockRoundRobinState(
    client,
    empresaId,
    normalizedCampaign
  )
  const usuarioId = chooseNextExecutive(
    executiveIds,
    lastExecutiveId
  )
  const asignacionId = await createAssignment(
    client,
    {
      cuentaId,
      usuarioId
    }
  )

  await updateRoundRobinState(
    client,
    {
      empresaId,
      idCampania: normalizedCampaign,
      usuarioId
    }
  )

  await registerAssignmentHistory(
    client,
    {
      cuentaId,
      asignacionId,
      usuarioId
    }
  )

  return {
    status: 'assigned',
    asignacionId,
    usuarioId
  }
}

module.exports = {
  CarteraAssignmentError,
  EJECUTIVO_ROLE,
  assignRoundRobin,
  chooseNextExecutive,
  findActiveAssignment,
  listActiveExecutives,
  lockAccount,
  lockRoundRobinState,
  validateAssignmentInput
}
