import {
  useEffect,
  useState
} from 'react'

import { fetchPortfolioAlerts } from './cartera-alerts-api'
import { formatDate } from './cartera.constants'

const EMPTY_TOTALS = {
  managedYesterday: 0,
  accountsManagedYesterday: 0,
  promisesCreatedYesterday: 0,
  paymentsReportedYesterday: 0,
  accountsClosedYesterday: 0,
  unmanaged: 0,
  newAssignments: 0,
  promisesOverdue: 0,
  promisesToday: 0,
  followupsOverdue: 0,
  followupsToday: 0,
  paymentsPending: 0
}

function mexicoCityDateKey() {
  const parts = new Intl.DateTimeFormat(
    'en-US',
    {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }
  ).formatToParts(new Date())
  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  )

  return `${values.year}-${values.month}-${values.day}`
}

function BriefMetric({ label, value, tone }) {
  const tones = {
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
    green: 'border-green-200 bg-green-50 text-green-800',
    orange: 'border-orange-200 bg-orange-50 text-orange-800',
    red: 'border-red-200 bg-red-50 text-red-800',
    gray: 'border-gray-200 bg-gray-50 text-gray-800'
  }

  return (
    <div className={`rounded-2xl border p-4 ${tones[tone] || tones.gray}`}>
      <p className="text-xs font-bold uppercase tracking-wide">
        {label}
      </p>
      <p className="mt-2 text-3xl font-normal">
        {new Intl.NumberFormat('es-MX').format(Number(value) || 0)}
      </p>
    </div>
  )
}

export default function CarteraDailyBrief({
  usuario,
  onReview
}) {
  const [open, setOpen] = useState(false)
  const [alerts, setAlerts] = useState(null)
  const [error, setError] = useState('')
  const storageKey = (
    usuario?.id
      ? `crm:resumen-operativo:${usuario.id}:${mexicoCityDateKey()}`
      : ''
  )

  useEffect(() => {
    if (
      !storageKey
      || localStorage.getItem(storageKey) === 'visto'
    ) {
      return undefined
    }

    let active = true

    fetchPortfolioAlerts()
      .then(data => {
        if (active) {
          setAlerts(data)
          setError('')
          setOpen(true)
        }
      })
      .catch(requestError => {
        if (active) {
          setError(requestError.message)
          setOpen(true)
        }
      })

    return () => {
      active = false
    }
  }, [storageKey])

  if (!open) return null

  const totals = alerts?.totals || EMPTY_TOTALS
  const executives = Array.isArray(alerts?.executives)
    ? alerts.executives
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

  function closeBrief() {
    if (storageKey) {
      localStorage.setItem(storageKey, 'visto')
    }

    setOpen(false)
  }

  function reviewPending() {
    closeBrief()
    onReview()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="daily-brief-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
    >
      <section className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-white p-6">
          <div>
            <p className="text-sm font-bold text-orange-600">
              RESUMEN OPERATIVO DEL DÍA
            </p>
            <h2 id="daily-brief-title" className="mt-1 text-3xl font-bold">
              {isExecutive
                ? `Buenos días, ${usuario?.nombre || 'ejecutivo'}`
                : 'Resumen general de cartera'}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Resultado de ayer y asuntos que requieren atención hoy.
            </p>
          </div>

          <button
            type="button"
            onClick={closeBrief}
            aria-label="Cerrar resumen operativo"
            className="rounded-xl bg-gray-900 px-4 py-2 font-bold text-white hover:bg-orange-600"
          >
            Cerrar
          </button>
        </header>

        <div className="p-6">
          {error && (
            <div role="alert" className="rounded-2xl border border-red-300 bg-red-50 p-4 text-red-700">
              {error}
            </div>
          )}

          {!error && alerts && (
            <>
              <section>
                <h3 className="text-xl font-bold">
                  Resultado del día anterior
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  {alerts.previousDayDate
                    ? formatDate(alerts.previousDayDate)
                    : 'Ayer'}
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <BriefMetric label="Gestiones" value={totals.managedYesterday} tone="green" />
                  <BriefMetric label="Cuentas atendidas" value={totals.accountsManagedYesterday} tone="blue" />
                  <BriefMetric label="Promesas" value={totals.promisesCreatedYesterday} tone="orange" />
                  <BriefMetric label="Pagos reportados" value={totals.paymentsReportedYesterday} tone="blue" />
                  <BriefMetric label="Cierres" value={totals.accountsClosedYesterday} tone="gray" />
                </div>
              </section>

              <section className="mt-7">
                <h3 className="text-xl font-bold">
                  Pendientes para hoy
                </h3>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <BriefMetric label="Vencidos" value={overdue} tone="red" />
                  <BriefMetric label="Para hoy" value={dueToday} tone="orange" />
                  <BriefMetric label="Pagos por validar" value={totals.paymentsPending} tone="blue" />
                  <BriefMetric label="Sin gestionar" value={totals.unmanaged} tone="gray" />
                  <BriefMetric label="Nuevas asignaciones" value={totals.newAssignments} tone="green" />
                </div>
              </section>

              {!isExecutive && (
                <section className="mt-7 overflow-x-auto rounded-2xl border">
                  <table className="min-w-[900px] w-full text-sm">
                    <thead className="bg-gray-50 text-left">
                      <tr>
                        <th className="p-3">Ejecutivo</th>
                        <th className="p-3 text-right">Gestiones ayer</th>
                        <th className="p-3 text-right">Sin gestionar</th>
                        <th className="p-3 text-right">Vencidos</th>
                        <th className="p-3 text-right">Para hoy</th>
                        <th className="p-3 text-right">Pagos por validar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {executives.map(item => (
                        <tr key={item.id}>
                          <td className="p-3 font-bold">{item.name}</td>
                          <td className="p-3 text-right">{item.managedYesterday}</td>
                          <td className="p-3 text-right">{item.unmanaged}</td>
                          <td className="p-3 text-right text-red-700">
                            {item.promisesOverdue + item.followupsOverdue}
                          </td>
                          <td className="p-3 text-right text-orange-700">
                            {item.promisesToday + item.followupsToday}
                          </td>
                          <td className="p-3 text-right text-blue-700">
                            {item.paymentsPending}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              <div className="mt-7 flex flex-wrap justify-end gap-3 border-t pt-5">
                <button
                  type="button"
                  onClick={closeBrief}
                  className="rounded-xl border border-gray-300 bg-white px-5 py-3 font-bold text-gray-700 hover:bg-gray-50"
                >
                  Cerrar por ahora
                </button>
                <button
                  type="button"
                  onClick={reviewPending}
                  className="rounded-xl bg-orange-600 px-5 py-3 font-bold text-white hover:bg-orange-700"
                >
                  Ver pendientes
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
