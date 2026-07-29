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
  ['codigo_postal', 'codigoPostal']
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

function validatePersistenceInput({
  pool,
  empresaId,
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
      AND archivo_sha256 = $2
    FOR UPDATE
    `,
    [
      empresaId,
      sha256
    ]
  )

  return result.rows[0] || null
}

async function findCompletedImportByDate(
  client,
  empresaId,
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
      AND fecha_cartera = $2
      AND estado = 'completada'
    FOR UPDATE
    `,
    [
      empresaId,
      date
    ]
  )

  return result.rows[0] || null
}

async function startImport(
  client,
  {
    empresaId,
    portfolio,
    creadoPor
  }
) {
  const existing = await findImportByHash(
    client,
    empresaId,
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
      'procesando',
      $5,
      NOW()
    )
    RETURNING id
    `,
    [
      empresaId,
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
      id_campania,
      id_cliente,
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
      $4,
      $5
    )
    ON CONFLICT
    (
      empresa_id,
      id_campania,
      id_cliente
    )
    DO NOTHING
    RETURNING id
    `,
    [
      empresaId,
      identity.idCampania,
      identity.idCliente,
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
        $4
      ),
      ultima_importacion_id = CASE
        WHEN $4 >= ultima_fecha_cartera
          THEN $5
        ELSE ultima_importacion_id
      END,
      ultima_fecha_cartera = GREATEST(
        ultima_fecha_cartera,
        $4
      ),
      activa = TRUE,
      actualizada_at = NOW()
    WHERE
      empresa_id = $1
      AND id_campania = $2
      AND id_cliente = $3
    RETURNING id
    `,
    [
      empresaId,
      identity.idCampania,
      identity.idCliente,
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
    snapshot
  }
) {
  const values = [
    importacionId,
    cuentaId,
    ...SNAPSHOT_FIELDS.map(
      ([, key]) => snapshot[key] ?? null
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
      'fallida',
      $5,
      $6,
      $7,
      NOW(),
      NOW()
    )
    ON CONFLICT
    (
      empresa_id,
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
  portfolio,
  creadoPor = null
}) {
  validatePersistenceInput({
    pool,
    empresaId,
    portfolio
  })

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
        `cartera:${empresaId}:${portfolio.date}`
      ]
    )

    const importation = await startImport(
      client,
      {
        empresaId,
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
    const campaigns = new Set()

    for (const record of portfolio.records) {
      campaigns.add(record.identity.idCampania)

      const account = await upsertAccount(
        client,
        {
          empresaId,
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
          snapshot: record.snapshot
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
      updatedRecords
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
  insertSnapshot,
  persistPortfolio,
  recordFailedImport,
  startImport,
  upsertAccount,
  validatePersistenceInput
}
