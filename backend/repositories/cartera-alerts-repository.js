const {
  ROLES
} = require('../config/constants')

const {
  CarteraReadError,
  normalizeOptionalBigintId,
  resolveAccessScope,
  resolvePortfolioOrigin
} = require('./cartera-read-repository')

const ALERT_ITEMS_LIMIT = 50

function countValue(value) {
  const number = Number(value || 0)

  return Number.isSafeInteger(number)
    && number >= 0
    ? number
    : 0
}

function buildPortfolioAlertStatement({
  scope,
  originId = null
}) {
  const values = [
    scope.empresaId,
    ROLES.EJECUTIVO
  ]
  const executiveConditions = [
    'u.empresa_id = $1',
    'u.rol = $2',
    'u.activo = TRUE'
  ]
  const accountConditions = [
    'c.empresa_id = $1',
    'c.activa = TRUE',
    'c.en_corte_actual = TRUE'
  ]
  const historicalAccountConditions = [
    'history_account.empresa_id = $1'
  ]

  if (scope.isExecutive) {
    values.push(scope.userId)
    executiveConditions.push(
      `u.id = $${values.length}`
    )
  }

  if (originId) {
    values.push(originId)
    accountConditions.push(
      `c.origen_id = $${values.length}`
    )
    historicalAccountConditions.push(
      `history_account.origen_id = $${values.length}`
    )
  }

  return {
    values,
    ctes: `
      WITH eligible_executives AS (
        SELECT
          u.id,
          u.nombre
        FROM public.usuarios u
        WHERE ${executiveConditions.join('\n          AND ')}
      ),
      assigned_accounts AS (
        SELECT
          c.id AS account_id,
          c.estado_gestion,
          c.origen_id,
          c.id_campania,
          c.id_cliente,
          c.folio,
          a.usuario_id,
          a.asignada_at,
          s.nombre AS client_name,
          s.telefono_1 AS phone
        FROM public.cartera_cuentas c
        INNER JOIN public.cartera_asignaciones a
          ON a.cuenta_id = c.id
          AND a.activa = TRUE
        INNER JOIN eligible_executives e
          ON e.id = a.usuario_id
        LEFT JOIN public.cartera_snapshots s
          ON s.cuenta_id = c.id
          AND s.importacion_id = c.ultima_importacion_id
        WHERE ${accountConditions.join('\n          AND ')}
      ),
      latest_management AS (
        SELECT DISTINCT ON (g.cuenta_id)
          g.id,
          g.cuenta_id,
          g.proximo_seguimiento_at,
          g.seguimiento_estado,
          g.creada_at
        FROM public.cartera_gestiones g
        INNER JOIN assigned_accounts b
          ON b.account_id = g.cuenta_id
        WHERE g.empresa_id = $1
        ORDER BY
          g.cuenta_id,
          g.creada_at DESC,
          g.id DESC
      ),
      latest_promise_event AS (
        SELECT DISTINCT ON (g.cuenta_id)
          g.id,
          g.cuenta_id,
          g.promesa_monto,
          g.promesa_fecha,
          g.promesa_estado,
          g.creada_at
        FROM public.cartera_gestiones g
        INNER JOIN assigned_accounts b
          ON b.account_id = g.cuenta_id
        WHERE
          g.empresa_id = $1
          AND g.promesa_fecha IS NOT NULL
        ORDER BY
          g.cuenta_id,
          g.creada_at DESC,
          g.id DESC
      ),
      pending_promises AS (
        SELECT p.*
        FROM latest_promise_event p
        INNER JOIN assigned_accounts b
          ON b.account_id = p.cuenta_id
        WHERE
          p.promesa_estado = 'pendiente'
          AND b.estado_gestion IN (
            'promesa_pago',
            'convenio'
          )
      ),
      pending_followups AS (
        SELECT
          id,
          cuenta_id,
          proximo_seguimiento_at
        FROM latest_management
        WHERE
          seguimiento_estado = 'pendiente'
          AND proximo_seguimiento_at IS NOT NULL
      ),
      pending_payments AS (
        SELECT
          pv.id,
          pv.gestion_id,
          pv.cuenta_id,
          pv.reportado_at
        FROM public.cartera_pago_validaciones pv
        INNER JOIN assigned_accounts b
          ON b.account_id = pv.cuenta_id
        WHERE
          pv.empresa_id = $1
          AND pv.estado = 'pendiente'
      ),
      historical_activity AS (
        SELECT
          g.usuario_id,
          g.cuenta_id,
          g.promesa_fecha,
          g.estado_resultante,
          g.creada_at
        FROM public.cartera_gestiones g
        INNER JOIN public.cartera_cuentas history_account
          ON history_account.id = g.cuenta_id
        INNER JOIN eligible_executives e
          ON e.id = g.usuario_id
        WHERE
          g.empresa_id = $1
          AND ${historicalAccountConditions.join('\n          AND ')}
      ),
      executive_activity AS (
        SELECT
          e.id AS usuario_id,
          COUNT(h.creada_at) FILTER (
            WHERE
              (h.creada_at AT TIME ZONE
                'America/Mexico_City')::DATE
              = (CURRENT_TIMESTAMP AT TIME ZONE
                'America/Mexico_City')::DATE
          ) AS managed_today,
          COUNT(h.creada_at) FILTER (
            WHERE
              (h.creada_at AT TIME ZONE
                'America/Mexico_City')::DATE
              = (CURRENT_TIMESTAMP AT TIME ZONE
                'America/Mexico_City')::DATE - 1
          ) AS managed_yesterday,
          COUNT(DISTINCT h.cuenta_id) FILTER (
            WHERE
              (h.creada_at AT TIME ZONE
                'America/Mexico_City')::DATE
              = (CURRENT_TIMESTAMP AT TIME ZONE
                'America/Mexico_City')::DATE - 1
          ) AS accounts_managed_yesterday,
          COUNT(h.creada_at) FILTER (
            WHERE
              (h.creada_at AT TIME ZONE
                'America/Mexico_City')::DATE
              = (CURRENT_TIMESTAMP AT TIME ZONE
                'America/Mexico_City')::DATE - 1
              AND h.promesa_fecha IS NOT NULL
          ) AS promises_created_yesterday,
          COUNT(h.creada_at) FILTER (
            WHERE
              (h.creada_at AT TIME ZONE
                'America/Mexico_City')::DATE
              = (CURRENT_TIMESTAMP AT TIME ZONE
                'America/Mexico_City')::DATE - 1
              AND h.estado_resultante = 'pago_reportado'
          ) AS payments_reported_yesterday,
          COUNT(h.creada_at) FILTER (
            WHERE
              (h.creada_at AT TIME ZONE
                'America/Mexico_City')::DATE
              = (CURRENT_TIMESTAMP AT TIME ZONE
                'America/Mexico_City')::DATE - 1
              AND h.estado_resultante IN (
                'pago_realizado',
                'cerrado'
              )
          ) AS accounts_closed_yesterday,
          MAX(h.creada_at) AS last_activity_at
        FROM eligible_executives e
        LEFT JOIN historical_activity h
          ON h.usuario_id = e.id
        GROUP BY e.id
      ),
      executive_stats AS (
        SELECT
          b.usuario_id,
          COUNT(*) AS assigned,
          COUNT(*) FILTER (
            WHERE b.estado_gestion = 'sin_gestionar'
          ) AS unmanaged,
          COUNT(*) FILTER (
            WHERE
              (b.asignada_at AT TIME ZONE
                'America/Mexico_City')::DATE
              = (CURRENT_TIMESTAMP AT TIME ZONE
                'America/Mexico_City')::DATE
          ) AS new_assignments,
          COUNT(*) FILTER (
            WHERE lp.promesa_fecha < (
              CURRENT_TIMESTAMP AT TIME ZONE
                'America/Mexico_City'
            )::DATE
          ) AS promises_overdue,
          COUNT(*) FILTER (
            WHERE lp.promesa_fecha = (
              CURRENT_TIMESTAMP AT TIME ZONE
                'America/Mexico_City'
            )::DATE
          ) AS promises_today,
          COUNT(*) FILTER (
            WHERE
              (pf.proximo_seguimiento_at AT TIME ZONE
                'America/Mexico_City')::DATE
              < (CURRENT_TIMESTAMP AT TIME ZONE
                'America/Mexico_City')::DATE
          ) AS followups_overdue,
          COUNT(*) FILTER (
            WHERE
              (pf.proximo_seguimiento_at AT TIME ZONE
                'America/Mexico_City')::DATE
              = (CURRENT_TIMESTAMP AT TIME ZONE
                'America/Mexico_City')::DATE
          ) AS followups_today,
          COUNT(*) FILTER (
            WHERE pp.id IS NOT NULL
          ) AS payments_pending
        FROM assigned_accounts b
        LEFT JOIN pending_promises lp
          ON lp.cuenta_id = b.account_id
        LEFT JOIN pending_followups pf
          ON pf.cuenta_id = b.account_id
        LEFT JOIN pending_payments pp
          ON pp.cuenta_id = b.account_id
        GROUP BY b.usuario_id
      )
    `
  }
}

function normalizeExecutiveAlertRow(row = {}) {
  return {
    id: String(row.ejecutivo_id),
    name: row.ejecutivo_nombre || 'Sin nombre',
    assigned: countValue(row.asignadas),
    unmanaged: countValue(row.sin_gestionar),
    managedToday: countValue(row.gestiones_hoy),
    managedYesterday: countValue(row.gestiones_ayer),
    accountsManagedYesterday:
      countValue(row.cuentas_gestionadas_ayer),
    promisesCreatedYesterday:
      countValue(row.promesas_registradas_ayer),
    paymentsReportedYesterday:
      countValue(row.pagos_reportados_ayer),
    accountsClosedYesterday:
      countValue(row.cuentas_cerradas_ayer),
    newAssignments: countValue(row.nuevas_asignaciones),
    promisesOverdue: countValue(row.promesas_vencidas),
    promisesToday: countValue(row.promesas_hoy),
    followupsOverdue: countValue(row.seguimientos_vencidos),
    followupsToday: countValue(row.seguimientos_hoy),
    paymentsPending: countValue(row.pagos_pendientes),
    lastActivityAt: row.ultima_actividad_at || null
  }
}

function totalAlerts(executives) {
  return executives.reduce(
    (totals, item) => ({
      assigned: totals.assigned + item.assigned,
      unmanaged: totals.unmanaged + item.unmanaged,
      managedToday:
        totals.managedToday + item.managedToday,
      managedYesterday:
        totals.managedYesterday
        + countValue(item.managedYesterday),
      accountsManagedYesterday:
        totals.accountsManagedYesterday
        + countValue(item.accountsManagedYesterday),
      promisesCreatedYesterday:
        totals.promisesCreatedYesterday
        + countValue(item.promisesCreatedYesterday),
      paymentsReportedYesterday:
        totals.paymentsReportedYesterday
        + countValue(item.paymentsReportedYesterday),
      accountsClosedYesterday:
        totals.accountsClosedYesterday
        + countValue(item.accountsClosedYesterday),
      newAssignments:
        totals.newAssignments + item.newAssignments,
      promisesOverdue:
        totals.promisesOverdue + item.promisesOverdue,
      promisesToday:
        totals.promisesToday + item.promisesToday,
      followupsOverdue:
        totals.followupsOverdue + item.followupsOverdue,
      followupsToday:
        totals.followupsToday + item.followupsToday,
      paymentsPending:
        totals.paymentsPending + countValue(item.paymentsPending)
    }),
    {
      assigned: 0,
      unmanaged: 0,
      managedToday: 0,
      managedYesterday: 0,
      accountsManagedYesterday: 0,
      promisesCreatedYesterday: 0,
      paymentsReportedYesterday: 0,
      accountsClosedYesterday: 0,
      newAssignments: 0,
      promisesOverdue: 0,
      promisesToday: 0,
      followupsOverdue: 0,
      followupsToday: 0,
      paymentsPending: 0
    }
  )
}

function normalizeAlertItem(row = {}) {
  return {
    id: `${row.alerta_tipo}:${row.gestion_id}`,
    type: row.alerta_tipo,
    severity: row.severidad,
    dueAt: row.vence_at || null,
    managementId: String(row.gestion_id),
    accountId: String(row.cuenta_id),
    clientName: row.cliente_nombre || 'Sin nombre',
    clientId: row.id_cliente,
    folio: row.folio,
    campaign: row.id_campania,
    executiveId: String(row.ejecutivo_id),
    executiveName: row.ejecutivo_nombre || 'Sin nombre',
    amount: row.promesa_monto ?? null,
    phone: row.telefono || null
  }
}

async function getPortfolioAlerts({
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
  const statement = buildPortfolioAlertStatement({
    scope,
    originId
  })

  const summaryResult = await pool.query(
    `
    ${statement.ctes}
    SELECT
      e.id AS ejecutivo_id,
      e.nombre AS ejecutivo_nombre,
      COALESCE(s.assigned, 0) AS asignadas,
      COALESCE(s.unmanaged, 0) AS sin_gestionar,
      COALESCE(a.managed_today, 0) AS gestiones_hoy,
      COALESCE(a.managed_yesterday, 0) AS gestiones_ayer,
      COALESCE(
        a.accounts_managed_yesterday,
        0
      ) AS cuentas_gestionadas_ayer,
      COALESCE(
        a.promises_created_yesterday,
        0
      ) AS promesas_registradas_ayer,
      COALESCE(
        a.payments_reported_yesterday,
        0
      ) AS pagos_reportados_ayer,
      COALESCE(
        a.accounts_closed_yesterday,
        0
      ) AS cuentas_cerradas_ayer,
      (
        CURRENT_TIMESTAMP AT TIME ZONE
          'America/Mexico_City'
      )::DATE - 1 AS fecha_dia_anterior,
      COALESCE(s.new_assignments, 0) AS nuevas_asignaciones,
      COALESCE(s.promises_overdue, 0) AS promesas_vencidas,
      COALESCE(s.promises_today, 0) AS promesas_hoy,
      COALESCE(s.followups_overdue, 0) AS seguimientos_vencidos,
      COALESCE(s.followups_today, 0) AS seguimientos_hoy,
      COALESCE(s.payments_pending, 0) AS pagos_pendientes,
      a.last_activity_at AS ultima_actividad_at
    FROM eligible_executives e
    LEFT JOIN executive_stats s
      ON s.usuario_id = e.id
    LEFT JOIN executive_activity a
      ON a.usuario_id = e.id
    ORDER BY e.nombre, e.id
    `,
    statement.values
  )

  const itemsResult = await pool.query(
    `
    ${statement.ctes}
    SELECT *
    FROM (
      SELECT
        CASE
          WHEN lp.promesa_fecha < (
            CURRENT_TIMESTAMP AT TIME ZONE
              'America/Mexico_City'
          )::DATE
            THEN 'promesa_vencida'
          ELSE 'promesa_hoy'
        END AS alerta_tipo,
        CASE
          WHEN lp.promesa_fecha < (
            CURRENT_TIMESTAMP AT TIME ZONE
              'America/Mexico_City'
          )::DATE
            THEN 'urgente'
          ELSE 'hoy'
        END AS severidad,
        lp.promesa_fecha::TIMESTAMPTZ AS vence_at,
        lp.id AS gestion_id,
        b.account_id AS cuenta_id,
        b.client_name AS cliente_nombre,
        b.id_cliente,
        b.folio,
        b.id_campania,
        b.usuario_id AS ejecutivo_id,
        e.nombre AS ejecutivo_nombre,
        lp.promesa_monto,
        b.phone AS telefono
      FROM assigned_accounts b
      INNER JOIN eligible_executives e
        ON e.id = b.usuario_id
      INNER JOIN pending_promises lp
        ON lp.cuenta_id = b.account_id
      WHERE lp.promesa_fecha <= (
        CURRENT_TIMESTAMP AT TIME ZONE
          'America/Mexico_City'
      )::DATE

      UNION ALL

      SELECT
        CASE
          WHEN (pf.proximo_seguimiento_at AT TIME ZONE
            'America/Mexico_City')::DATE
            < (CURRENT_TIMESTAMP AT TIME ZONE
              'America/Mexico_City')::DATE
            THEN 'seguimiento_vencido'
          ELSE 'seguimiento_hoy'
        END AS alerta_tipo,
        CASE
          WHEN (pf.proximo_seguimiento_at AT TIME ZONE
            'America/Mexico_City')::DATE
            < (CURRENT_TIMESTAMP AT TIME ZONE
              'America/Mexico_City')::DATE
            THEN 'urgente'
          ELSE 'hoy'
        END AS severidad,
        pf.proximo_seguimiento_at AS vence_at,
        pf.id AS gestion_id,
        b.account_id AS cuenta_id,
        b.client_name AS cliente_nombre,
        b.id_cliente,
        b.folio,
        b.id_campania,
        b.usuario_id AS ejecutivo_id,
        e.nombre AS ejecutivo_nombre,
        NULL::NUMERIC AS promesa_monto,
        b.phone AS telefono
      FROM assigned_accounts b
      INNER JOIN eligible_executives e
        ON e.id = b.usuario_id
      INNER JOIN pending_followups pf
        ON pf.cuenta_id = b.account_id
      WHERE
        (pf.proximo_seguimiento_at AT TIME ZONE
          'America/Mexico_City')::DATE
        <= (CURRENT_TIMESTAMP AT TIME ZONE
          'America/Mexico_City')::DATE

      UNION ALL

      SELECT
        'pago_reportado' AS alerta_tipo,
        'hoy' AS severidad,
        pp.reportado_at AS vence_at,
        pp.gestion_id,
        b.account_id AS cuenta_id,
        b.client_name AS cliente_nombre,
        b.id_cliente,
        b.folio,
        b.id_campania,
        b.usuario_id AS ejecutivo_id,
        e.nombre AS ejecutivo_nombre,
        NULL::NUMERIC AS promesa_monto,
        b.phone AS telefono
      FROM assigned_accounts b
      INNER JOIN eligible_executives e
        ON e.id = b.usuario_id
      INNER JOIN pending_payments pp
        ON pp.cuenta_id = b.account_id
    ) alerts
    ORDER BY
      CASE alerts.severidad
        WHEN 'urgente' THEN 1
        ELSE 2
      END,
      alerts.vence_at,
      alerts.cuenta_id
    LIMIT ${ALERT_ITEMS_LIMIT}
    `,
    statement.values
  )

  const executives = summaryResult.rows.map(
    normalizeExecutiveAlertRow
  )
  const previousDayDate = (
    summaryResult.rows[0]?.fecha_dia_anterior
    || null
  )

  return {
    scope: scope.isExecutive
      ? 'ejecutivo'
      : 'empresa',
    origin,
    generatedAt: new Date().toISOString(),
    previousDayDate,
    totals: totalAlerts(executives),
    executives,
    items: itemsResult.rows.map(normalizeAlertItem)
  }
}

module.exports = {
  ALERT_ITEMS_LIMIT,
  buildPortfolioAlertStatement,
  getPortfolioAlerts,
  normalizeAlertItem,
  normalizeExecutiveAlertRow,
  totalAlerts
}
