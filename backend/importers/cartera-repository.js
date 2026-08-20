const {
  assignRoundRobin
} = require('./cartera-round-robin')

const SNAPSHOT_FIELDS = [
  ['nombre', 'nombre'],
  ['id_genero', 'idGenero'],
  ['edad', 'edad'],
  ['id_nivel_riesgo', 'idNivelRiesgo'],
  ['medio_contacto_sugerido', 'medioContactoSugerido'],
  ['telefono_1', 'telefono1'],
  ['tipo_telefono_1', 'tipoTelefono1'],
  ['telefono_2', 'telefono2'],
  ['tipo_telefono_2', 'tipoTelefono2'],
  ['telefono_3', 'telefono3'],
  ['tipo_telefono_3', 'tipoTelefono3'],
  ['telefono_4', 'telefono4'],
  ['tipo_telefono_4', 'tipoTelefono4'],
  ['correo_1', 'correo1'],
  ['correo_2', 'correo2'],
  ['id_pais', 'idPais'],
  ['id_canal', 'idCanal'],
  ['id_sucursal', 'idSucursal'],
  ['folio', 'folio'],
  ['semanas_atraso', 'semanasAtraso'],
  ['dias_atraso', 'diasAtraso'],
  ['dia_pago', 'diaPago'],
  ['saldo', 'saldo'],
  ['pago_requerido', 'pagoRequerido'],
  ['pago_minimo', 'pagoMinimo'],
  [
    'pago_no_genera_intereses',
    'pagoNoGeneraIntereses'
  ],
  ['abono_puntual', 'abonoPuntual'],
  ['abono_semanal', 'abonoSemanal'],
  ['fecha_proxima_pago', 'fechaProximaPago'],
  ['fecha_vencimiento', 'fechaVencimiento'],
  ['producto', 'producto'],
  ['codigo_postal', 'codigoPostal'],
  ['datos_origen', 'rawData']
]

const SNAPSHOT_COLUMNS = SNAPSHOT_FIELDS.map(
  ([column]) => column
)
const SNAPSHOT_PLACEHOLDERS = SNAPSHOT_FIELDS.map(
  (_, index) => `$${index + 3}`
)

const INSERT_SNAPSHOT_SQL = `
  INSERT INTO public.cartera_snapshots
  (
    importacion_id,
    cuenta_id,
    ${SNAPSHOT_COLUMNS.join(',\n    ')}
  )
  VALUES
  (
    $1,
    $2,
    ${SNAPSHOT_PLACEHOLDERS.join(',\n    ')}
  )
  ON CONFLICT
  (
    importacion_id,
    cuenta_id
  )
  DO NOTHING
  RETURNING id
`

class CarteraPersistenceError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CarteraPersistenceError'
    this.code = code
  }
}

function isPositiveDatabaseId(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0
  }

  return (
    typeof value === 'string'
    && /^[1-9]\d*$/.test(value)
  )
}

function validatePersistenceInput({
  pool,
  empresaId,
  origenId,
  integracionId,
  portfolio
}) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new CarteraPersistenceError(
      'BAZ_PERSIST_POOL_INVALID',
      'La conexión PostgreSQL no es válida'
    )
  }

  if (!Number.isInteger(empresaId) || empresaId <= 0) {
    throw new CarteraPersistenceError(
      'BAZ_PERSIST_EMPRESA_INVALID',
      'empresaId debe ser un entero positivo'
    )
  }

  if (!isPositiveDatabaseId(origenId)) {
    throw new CarteraPersistenceError(
      'BAZ_PERSIST_ORIGIN_INVALID',
      'origenId debe ser un identificador positivo'
    )
  }

  if (!isPositiveDatabaseId(integracionId)) {
    throw new CarteraPersistenceError(
      'BAZ_PERSIST_INTEGRATION_INVALID',
      'integracionId debe ser un identificador positivo'
    )
  }

  if (
    !portfolio
    || !portfolio.date
    || !portfolio.fileName
    || !/^[0-9a-f]{64}$/i.test(portfolio.sha256 || '')
    || !Array.isArray(portfolio.records)
    || portfolio.records.length === 0
  ) {
    throw new CarteraPersistenceError(
      'BAZ_PERSIST_PORTFOLIO_INVALID',
      'La cartera transformada está incompleta'
    )
  }
}

async function findImportByHash(
  client,
  empresaId,
  origenId,
  sha256
) {
  const result = await client.query(
    `
    SELECT
      id,
      estado
    FROM public.cartera_importaciones
    WHERE
      empresa_id = $1
      AND origen_id = $2
      AND archivo_sha256 = $3
    FOR UPDATE
    `,
    [
      empresaId,
      origenId,
      sha256
    ]
  )

  return result.rows[0] || null
}

async function findCompletedImportByDate(
  client,
  empresaId,
  origenId,
  date
) {
  const result = await client.query(
    `
    SELECT
      id,
      archivo_sha256
    FROM public.cartera_importaciones
    WHERE
      empresa_id = $1
      AND origen_id = $2
      AND fecha_cartera = $3
      AND estado = 'completada'
    FOR UPDATE
    `,
    [
      empresaId,
      origenId,
      date
    ]
  )

  return result.rows[0] || null
}

async function startImport(
  client,
  {
    empresaId,
    origenId,
    integracionId,
    portfolio,
    creadoPor
  }
) {
  const existing = await findImportByHash(
    client,
    empresaId,
    origenId,
    portfolio.sha256
  )

  if (existing?.estado === 'completada') {
    return {
      id: existing.id,
      alreadyImported: true
    }
  }

  const completedDate = await findCompletedImportByDate(
    client,
    empresaId,
    origenId,
    portfolio.date
  )

  if (
    completedDate
    && completedDate.archivo_sha256 !== portfolio.sha256
  ) {
    throw new CarteraPersistenceError(
      'BAZ_IMPORT_DATE_ALREADY_COMPLETED',
      'Ya existe una cartera completada para esta fecha'
    )
  }

  if (existing) {
    const retried = await client.query(
      `
      UPDATE public.cartera_importaciones
      SET
        estado = 'procesando',
        error_codigo = NULL,
        error_detalle = NULL,
        iniciada_at = NOW(),
        finalizada_at = NULL
      WHERE id = $1
      RETURNING id
      `,
      [
        existing.id
      ]
    )

    return {
      id: retried.rows[0].id,
      alreadyImported: false
    }
  }

  const created = await client.query(
    `
    INSERT INTO public.cartera_importaciones
    (
      empresa_id,
      origen_id,
      integracion_id,
      fecha_cartera,
      nombre_archivo,
      archivo_sha256,
      estado,
      creado_por,
      iniciada_at
    )
    VALUES
    (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      'procesando',
      $7,
      NOW()
    )
    RETURNING id
    `,
    [
      empresaId,
      origenId,
      integracionId,
      portfolio.date,
      portfolio.fileName,
      portfolio.sha256,
      creadoPor
    ]
  )

  return {
    id: created.rows[0].id,
    alreadyImported: false
  }
}

async function upsertAccount(
  client,
  {
    empresaId,
    origenId,
    importacionId,
    date,
    identity
  }
) {
  const inserted = await client.query(
    `
    INSERT INTO public.cartera_cuentas
    (
      empresa_id,
      origen_id,
      id_campania,
      id_cliente,
      folio,
      primera_fecha_cartera,
      ultima_fecha_cartera,
      ultima_importacion_id
    )
    VALUES
    (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      $6,
      $7
    )
    ON CONFLICT
    (
      empresa_id,
      origen_id,
      id_campania,
      id_cliente,
      folio
    )
    DO NOTHING
    RETURNING id
    `,
    [
      empresaId,
      origenId,
      identity.idCampania,
      identity.idCliente,
      identity.folio,
      date,
      importacionId
    ]
  )

  if (inserted.rows[0]) {
    return {
      id: inserted.rows[0].id,
      isNew: true
    }
  }

  const updated = await client.query(
    `
    UPDATE public.cartera_cuentas
    SET
      primera_fecha_cartera = LEAST(
        primera_fecha_cartera,
        $6
      ),
      ultima_importacion_id = CASE
        WHEN $6 >= ultima_fecha_cartera
          THEN $7
        ELSE ultima_importacion_id
      END,
      ultima_fecha_cartera = GREATEST(
        ultima_fecha_cartera,
        $6
      ),
      activa = TRUE,
      actualizada_at = NOW()
    WHERE
      empresa_id = $1
      AND origen_id = $2
      AND id_campania = $3
      AND id_cliente = $4
      AND folio = $5
    RETURNING id
    `,
    [
      empresaId,
      origenId,
      identity.idCampania,
      identity.idCliente,
      identity.folio,
      date,
      importacionId
    ]
  )

  if (!updated.rows[0]) {
    throw new CarteraPersistenceError(
      'BAZ_ACCOUNT_UPSERT_FAILED',
      'No fue posible crear o actualizar la cuenta'
    )
  }

  return {
    id: updated.rows[0].id,
    isNew: false
  }
}

async function insertSnapshot(
  client,
  {
    importacionId,
    cuentaId,
    snapshot,
    rawData
  }
) {
  const snapshotValues = {
    ...snapshot,
    rawData: rawData || {}
  }
  const values = [
    importacionId,
    cuentaId,
    ...SNAPSHOT_FIELDS.map(
      ([, key]) => snapshotValues[key] ?? null
    )
  ]
  const result = await client.query(
    INSERT_SNAPSHOT_SQL,
    values
  )

  if (!result.rows[0]) {
    throw new CarteraPersistenceError(
      'BAZ_SNAPSHOT_DUPLICATE',
      'La cuenta ya tiene un snapshot en esta importación'
    )
  }

  return result.rows[0].id
}

async function registerNewAccountHistory(
  client,
  {
    cuentaId,
    importacionId,
    creadoPor,
    date
  }
) {
  await client.query(
    `
    INSERT INTO public.cartera_historial
    (
      cuenta_id,
      importacion_id,
      usuario_id,
      evento,
      detalle,
      valor_nuevo
    )
    VALUES
    (
      $1,
      $2,
      $3,
      'cuenta_importada',
      'Cuenta creada desde la cartera automática',
      $4::JSONB
    )
    `,
    [
      cuentaId,
      importacionId,
      creadoPor,
      JSON.stringify({
        fechaCartera: date
      })
    ]
  )
}

async function completeImport(
  client,
  {
    importacionId,
    campaigns,
    totalRows,
    newRecords,
    updatedRecords
  }
) {
  const result = await client.query(
    `
    UPDATE public.cartera_importaciones
    SET
      estado = 'completada',
      campanias_detectadas = $2,
      registros_leidos = $3,
      registros_nuevos = $4,
      registros_actualizados = $5,
      registros_duplicados = 0,
      registros_omitidos = 0,
      finalizada_at = NOW()
    WHERE id = $1
    RETURNING id
    `,
    [
      importacionId,
      campaigns,
      totalRows,
      newRecords,
      updatedRecords
    ]
  )

  if (!result.rows[0]) {
    throw new CarteraPersistenceError(
      'BAZ_IMPORT_COMPLETE_FAILED',
      'No fue posible completar la importación'
    )
  }
}

async function recordFailedImport(
  pool,
  {
    empresaId,
    origenId,
    integracionId,
    portfolio,
    creadoPor,
    error
  }
) {
  const controlled = (
    typeof error.code === 'string'
    && error.code.startsWith('BAZ_')
  )
  const code = controlled
    ? error.code.slice(0, 100)
    : 'BAZ_IMPORT_UNEXPECTED'
  const detail = controlled
    ? String(error.message || 'Error controlado')
    : 'Error interno durante la importación'

  await pool.query(
    `
    INSERT INTO public.cartera_importaciones
    (
      empresa_id,
      origen_id,
      integracion_id,
      fecha_cartera,
      nombre_archivo,
      archivo_sha256,
      estado,
      error_codigo,
      error_detalle,
      creado_por,
      iniciada_at,
      finalizada_at
    )
    VALUES
    (
      $1,
      $2,
      $3,
      $4,
      $5,
      $6,
      'fallida',
      $7,
      $8,
      $9,
      NOW(),
      NOW()
    )
    ON CONFLICT
    (
      empresa_id,
      origen_id,
      archivo_sha256
    )
    DO UPDATE SET
      estado = 'fallida',
      error_codigo = EXCLUDED.error_codigo,
      error_detalle = EXCLUDED.error_detalle,
      finalizada_at = NOW()
    WHERE
      cartera_importaciones.estado <> 'completada'
    `,
    [
      empresaId,
      origenId,
      integracionId,
      portfolio.date,
      portfolio.fileName,
      portfolio.sha256,
      code,
      detail,
      creadoPor
    ]
  )
}

async function persistPortfolio({
  pool,
  empresaId,
  origenId,
  integracionId,
  portfolio,
  creadoPor = null,
  assignFn = assignRoundRobin
}) {
  validatePersistenceInput({
    pool,
    empresaId,
    origenId,
    integracionId,
    portfolio
  })

  if (typeof assignFn !== 'function') {
    throw new CarteraPersistenceError(
      'BAZ_PERSIST_ASSIGNER_INVALID',
      'La función de asignación no es válida'
    )
  }

  const client = await pool.connect()
  let transactionStarted = false

  try {
    await client.query('BEGIN')
    transactionStarted = true

    await client.query(
      `
      SELECT pg_advisory_xact_lock(
        hashtext($1)
      )
      `,
      [
        `cartera:${empresaId}:${origenId}:${portfolio.date}`
      ]
    )

    const importation = await startImport(
      client,
      {
        empresaId,
        origenId,
        integracionId,
        portfolio,
        creadoPor
      }
    )

    if (importation.alreadyImported) {
      await client.query('ROLLBACK')
      transactionStarted = false

      return {
        status: 'already_imported',
        importacionId: importation.id,
        totalRows: portfolio.records.length
      }
    }

    let newRecords = 0
    let updatedRecords = 0
    let assignedRecords = 0
    let keptAssignments = 0
    const campaigns = new Set()

    for (const record of portfolio.records) {
      campaigns.add(record.identity.idCampania)

      const account = await upsertAccount(
        client,
        {
          empresaId,
          origenId,
          importacionId: importation.id,
          date: portfolio.date,
          identity: record.identity
        }
      )

      await insertSnapshot(
        client,
        {
          importacionId: importation.id,
          cuentaId: account.id,
          snapshot: record.snapshot,
          rawData: record.rawData
        }
      )

      if (account.isNew) {
        newRecords++

        await registerNewAccountHistory(
          client,
          {
            cuentaId: account.id,
            importacionId: importation.id,
            creadoPor,
            date: portfolio.date
          }
        )
      } else {
        updatedRecords++
      }

      const assignment = await assignFn({
        client,
        empresaId,
        origenId,
        cuentaId: account.id,
        idCampania: record.identity.idCampania
      })

      if (assignment.status === 'assigned') {
        assignedRecords++
      } else if (assignment.status === 'kept') {
        keptAssignments++
      } else {
        throw new CarteraPersistenceError(
          'BAZ_ASSIGN_RESULT_INVALID',
          'La asignación devolvió un estado desconocido'
        )
      }
    }

    await completeImport(
      client,
      {
        importacionId: importation.id,
        campaigns: campaigns.size,
        totalRows: portfolio.records.length,
        newRecords,
        updatedRecords
      }
    )

    await client.query('COMMIT')
    transactionStarted = false

    return {
      status: 'imported',
      importacionId: importation.id,
      campaigns: campaigns.size,
      totalRows: portfolio.records.length,
      newRecords,
      updatedRecords,
      assignedRecords,
      keptAssignments
    }
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // La conexión será liberada sin reutilizar la transacción.
      }
    }

    try {
      await recordFailedImport(
        client,
        {
          empresaId,
          origenId,
          integracionId,
          portfolio,
          creadoPor,
          error
        }
      )
    } catch {
      // El error original conserva la prioridad.
    }

    throw error
  } finally {
    client.release()
  }
}

module.exports = {
  CarteraPersistenceError,
  SNAPSHOT_FIELDS,
  completeImport,
  isPositiveDatabaseId,
  insertSnapshot,
  persistPortfolio,
  recordFailedImport,
  startImport,
  upsertAccount,
  validatePersistenceInput
}
