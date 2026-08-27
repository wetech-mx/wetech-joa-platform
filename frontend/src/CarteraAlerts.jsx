import {
  useEffect,
  useState
} from 'react'

import { apiFetch } from './api'
import {
  formatDate,
  formatMoney
} from './cartera.constants'

const EMPTY_TOTALS = {
  assigned: 0,
  unmanaged: 0,
  managedToday: 0,
  newAssignments: 0,
  promisesOverdue: 0,
  promisesToday: 0,
  followupsOverdue: 0,
  followupsToday: 0,
  paymentsPending: 0
}

const ALERT_LABELS = {
  promesa_vencida: 'Promesa vencida',
  promesa_hoy: 'Promesa para hoy',
  seguimiento_vencido: 'Seguimiento vencido',
  seguimiento_hoy: 'Seguimiento para hoy',
  pago_reportado: 'Pago por validar'
}

function formatNumber(value) {
  return new Intl.NumberFormat('es-MX').format(
    Number(value) || 0
  )
}

function formatDateTime(value) {
  if (!value) return 'Sin actividad'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Sin actividad'
  }

  return new Intl.DateTimeFormat(
    'es-MX',
    {
      dateStyle: 'medium',
      timeStyle: 'short'
    }
  ).format(date)
}

function PendingMetric({
  label,
  value,
  tone = 'gray'
}) {
  const tones = {
    red: 'border-red-300 bg-red-50 text-red-700',
    orange: 'border-orange-300 bg-orange-50 text-orange-700',
    blue: 'border-blue-300 bg-blue-50 text-blue-700',
    green: 'border-green-300 bg-green-50 text-green-700',
    purple: 'border-purple-300 bg-purple-50 text-purple-700',
    gray: 'border-gray-300 bg-gray-50 text-gray-700'
  }

  return (
    <article
      className={`rounded-2xl border p-4 ${tones[tone] || tones.gray}`}
    >
      <p className="text-xs font-bold uppercase tracking-wide">
        {label}
      </p>
      <p className="mt-2 text-3xl font-normal">
        {formatNumber(value)}
      </p>
    </article>
  )
}

function AlertBadge({ item }) {
  const urgent = item.severity === 'urgente'

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
        urgent
          ? 'bg-red-100 text-red-700'
          : 'bg-amber-100 text-amber-800'
      }`}
    >
      {ALERT_LABELS[item.type] || item.type}
    </span>
  )
}

export default function CarteraAlerts({
  originId,
  refreshVersion,
  onOpenAccount
}) {
  const [alerts, setAlerts] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams()

    if (originId) {
      params.set('origen', originId)
    }

    const query = params.toString()
    const endpoint = query
      ? `/crm-api/cartera/alertas?${query}`
      : '/crm-api/cartera/alertas'

    apiFetch(endpoint, {
      signal: controller.signal
    })
      .then(async response => {
        const data = await response
          .json()
          .catch(() => ({}))

        if (!response.ok) {
          throw new Error(
            data.error
            || 'No fue posible consultar los pendientes'
          )
        }

        return data
      })
      .then(data => {
        setAlerts(data)
        setError('')
      })
      .catch(requestError => {
        if (requestError.name !== 'AbortError') {
          setAlerts(null)
          setError(requestError.message)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [
    originId,
    refreshVersion
  ])

  const totals = alerts?.totals || EMPTY_TOTALS
  const executives = Array.isArray(alerts?.executives)
    ? alerts.executives
    : []
  const items = Array.isArray(alerts?.items)
    ? alerts.items
    : []
  const isExecutive = alerts?.scope === 'ejecutivo'
  const overdue = (
    Number(totals.promisesOverdue || 0)
    + Number(totals.followupsOverdue || 0)
  )
  const dueToday = (
    Number(totals.promisesToday || 0)
    + Number(totals.followupsToday || 0)
  )

  return (
    <section className="mt-6 rounded-3xl bg-white p-6 shadow">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-blue-600">
            ALERTAS DE CARTERA
          </p>
          <h3 className="mt-1 text-2xl font-bold">
            {isExecutive
              ? 'Mi resumen de pendientes'
              : 'Supervisión por ejecutivo'}
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Promesas, seguimientos y carga que requieren atención.
          </p>
        </div>

        {!loading && !error && (
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-red-100 px-3 py-1 font-bold text-red-700">
              {formatNumber(overdue)} vencidos
            </span>
            <span className="rounded-full bg-amber-100 px-3 py-1 font-bold text-amber-800">
              {formatNumber(dueToday)} para hoy
            </span>
            <span className="rounded-full bg-blue-100 px-3 py-1 font-bold text-blue-700">
              {formatNumber(totals.paymentsPending)} pagos por validar
            </span>
          </div>
        )}
      </div>

      {loading && (
        <p className="mt-5 rounded-2xl bg-gray-50 p-4 text-sm text-gray-500">
          Consultando pendientes…
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-4 text-red-700"
        >
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
            <PendingMetric
              label="Sin gestionar"
              value={totals.unmanaged}
              tone="gray"
            />
            <PendingMetric
              label="Gestiones hoy"
              value={totals.managedToday}
              tone="green"
            />
            <PendingMetric
              label="Nuevas asignaciones"
              value={totals.newAssignments}
              tone="blue"
            />
            <PendingMetric
              label="Promesas vencidas"
              value={totals.promisesOverdue}
              tone="red"
            />
            <PendingMetric
              label="Promesas hoy"
              value={totals.promisesToday}
              tone="orange"
            />
            <PendingMetric
              label="Seguimientos vencidos"
              value={totals.followupsOverdue}
              tone="red"
            />
            <PendingMetric
              label="Seguimientos hoy"
              value={totals.followupsToday}
              tone="purple"
            />
            <PendingMetric
              label="Pagos por validar"
              value={totals.paymentsPending}
              tone="blue"
            />
          </div>

          {!isExecutive && (
            <div className="mt-6 overflow-x-auto rounded-2xl border">
              <table className="min-w-[1280px] w-full text-sm">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="p-3">Ejecutivo</th>
                    <th className="p-3 text-right">Asignadas</th>
                    <th className="p-3 text-right">Sin gestionar</th>
                    <th className="p-3 text-right">Gestiones hoy</th>
                    <th className="p-3 text-right">Promesas vencidas</th>
                    <th className="p-3 text-right">Seguimientos vencidos</th>
                    <th className="p-3 text-right">Para hoy</th>
                    <th className="p-3 text-right">Pagos por validar</th>
                    <th className="p-3">Última actividad</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {executives.map(item => {
                    const pendingCount = (
                      item.promisesOverdue
                      + item.followupsOverdue
                      + item.promisesToday
                      + item.followupsToday
                      + item.paymentsPending
                    )

                    return (
                    <tr
                      key={item.id}
                      className={pendingCount > 0
                        ? 'bg-amber-50'
                        : ''}
                    >
                      <td className="p-3">
                        <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 font-bold text-blue-900">
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 rounded-full bg-blue-600"
                          />
                          {item.name}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        {formatNumber(item.assigned)}
                      </td>
                      <td className="p-3 text-right">
                        {formatNumber(item.unmanaged)}
                      </td>
                      <td className="p-3 text-right text-green-700">
                        {formatNumber(item.managedToday)}
                      </td>
                      <td className="p-3 text-right font-bold text-red-700">
                        {formatNumber(item.promisesOverdue)}
                      </td>
                      <td className="p-3 text-right font-bold text-red-700">
                        {formatNumber(item.followupsOverdue)}
                      </td>
                      <td className="p-3 text-right text-amber-800">
                        {formatNumber(
                          item.promisesToday
                          + item.followupsToday
                        )}
                      </td>
                      <td className="p-3 text-right font-bold text-blue-700">
                        {formatNumber(item.paymentsPending)}
                      </td>
                      <td className="p-3 text-gray-600">
                        {formatDateTime(item.lastActivityAt)}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>

              {executives.length === 0 && (
                <p className="p-5 text-sm text-gray-500">
                  No hay ejecutivos activos para mostrar.
                </p>
              )}
            </div>
          )}

          <div className="mt-6">
            <h4 className="text-lg font-bold">
              Pendientes que requieren atención
            </h4>
            <p className="mt-1 text-sm text-gray-500">
              Se muestran vencidos, programados para hoy y pagos por validar.
            </p>

            {items.length === 0 ? (
              <p className="mt-4 rounded-2xl bg-green-50 p-4 text-sm text-green-700">
                No hay promesas, seguimientos ni pagos que requieran atención.
              </p>
            ) : (
              <div className="mt-4 divide-y overflow-hidden rounded-2xl border">
                {items.map(item => (
                  <article
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-4 p-4 hover:bg-gray-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertBadge item={item} />
                        <span className="text-sm text-gray-500">
                          {item.type === 'pago_reportado'
                            ? formatDateTime(item.dueAt)
                            : formatDate(item.dueAt)}
                        </span>
                      </div>
                      <p className="mt-2 font-bold">
                        {item.clientName}
                      </p>
                      {!isExecutive && (
                        <div className="mt-2 inline-flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-blue-900">
                          <span className="text-xs font-bold uppercase tracking-wide text-blue-600">
                            Ejecutivo responsable
                          </span>
                          <span className="font-bold">
                            {item.executiveName}
                          </span>
                        </div>
                      )}
                      <p className="mt-1 text-xs text-gray-500">
                        Folio: {item.folio || '—'}
                        {' · '}
                        Campaña: {item.campaign || '—'}
                      </p>
                      {item.amount !== null && (
                        <p className="mt-1 text-sm font-bold text-orange-700">
                          Promesa: {formatMoney(item.amount)}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenAccount(item.accountId)}
                      className="rounded-xl bg-gray-900 px-4 py-2 font-bold text-white hover:bg-orange-600"
                    >
                      Abrir cuenta
                    </button>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
