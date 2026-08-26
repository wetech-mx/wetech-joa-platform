import {
  useEffect,
  useState
} from 'react'

import { apiFetch } from './api'
import CarteraAlerts from './CarteraAlerts'
import {
  CARTERA_ESTADO_LABEL,
  formatDate,
  formatMoney
} from './cartera.constants'

const EMPTY_TOTALS = {
  accounts: 0,
  assigned: 0,
  unassigned: 0,
  campaigns: 0,
  balance: '0',
  requiredPayment: '0',
  portfolioDate: null
}

function formatNumber(value) {
  return new Intl.NumberFormat('es-MX').format(
    Number(value) || 0
  )
}

function MetricCard({
  label,
  value,
  detail,
  tone
}) {
  const tones = {
    orange: 'border-orange-500 bg-orange-50 text-orange-700',
    blue: 'border-blue-500 bg-blue-50 text-blue-700',
    green: 'border-green-500 bg-green-50 text-green-700',
    purple: 'border-purple-500 bg-purple-50 text-purple-700',
    red: 'border-red-500 bg-red-50 text-red-700',
    gray: 'border-gray-500 bg-gray-50 text-gray-700'
  }

  return (
    <article
      className={`rounded-2xl border-l-4 p-5 shadow-sm ${tones[tone] || tones.gray}`}
    >
      <p className="text-xs font-bold uppercase tracking-wide">
        {label}
      </p>
      <p className="mt-2 break-words text-3xl font-normal">
        {value}
      </p>
      {detail && (
        <p className="mt-2 text-xs opacity-80">
          {detail}
        </p>
      )}
    </article>
  )
}

function DistributionList({
  items,
  labelKey,
  labelFor,
  emptyMessage,
  colorClass
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">
        {emptyMessage}
      </p>
    )
  }

  const maximum = Math.max(
    ...items.map(item => Number(item.total) || 0),
    1
  )

  return (
    <div className="space-y-4">
      {items.map(item => {
        const label = labelFor(item[labelKey])
        const total = Number(item.total) || 0
        const width = Math.max(
          (total / maximum) * 100,
          total > 0 ? 4 : 0
        )

        return (
          <div key={String(item[labelKey])}>
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="font-normal text-gray-700">
                {label}
              </span>
              <span className="font-normal text-gray-900">
                {formatNumber(total)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full ${colorClass}`}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function CarteraDashboard({
  onOpenAccount
}) {
  const [summary, setSummary] = useState(null)
  const [origins, setOrigins] = useState([])
  const [selectedOriginId, setSelectedOriginId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  const selectedOrigin = origins.find(
    item => String(item.id) === String(selectedOriginId)
  )

  useEffect(() => {
    let active = true

    apiFetch('/crm-api/cartera/origenes')
      .then(async response => {
        const data = await response
          .json()
          .catch(() => ({}))

        if (!response.ok) {
          throw new Error(
            data.error
            || 'No fue posible consultar los orígenes'
          )
        }

        return data
      })
      .then(data => {
        if (active && Array.isArray(data)) {
          setOrigins(data)
        }
      })
      .catch(requestError => {
        if (active) {
          setError(requestError.message)
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const params = new URLSearchParams()

    if (selectedOriginId) {
      params.set('origen', selectedOriginId)
    }

    const query = params.toString()
    const endpoint = query
      ? `/crm-api/cartera/resumen?${query}`
      : '/crm-api/cartera/resumen'

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
            || 'No fue posible consultar el resumen de cartera'
          )
        }

        return data
      })
      .then(data => {
        if (active) {
          setSummary(data)
          setError('')
        }
      })
      .catch(requestError => {
        if (
          active
          && requestError.name !== 'AbortError'
        ) {
          setSummary(null)
          setError(requestError.message)
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [
    refreshVersion,
    selectedOriginId
  ])

  const totals = summary?.totals || EMPTY_TOTALS
  const states = Array.isArray(summary?.states)
    ? summary.states
    : []
  const risks = Array.isArray(summary?.risks)
    ? summary.risks
    : []
  const executives = Array.isArray(summary?.executives)
    ? summary.executives
    : []

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-orange-600">
            {selectedOrigin
              ? `CARTERA · ${selectedOrigin.nombre.toUpperCase()}`
              : 'CARTERA · TODOS LOS ORÍGENES'}
          </p>
          <h2 className="mt-1 text-3xl font-bold">
            Resumen operativo
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            Última fecha de cartera:{' '}
            <strong>
              {formatDate(totals.portfolioDate)}
            </strong>
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-normal text-gray-700">
            Origen
            <select
              value={selectedOriginId}
              onChange={event => {
                setLoading(true)
                setSelectedOriginId(event.target.value)
              }}
              className="mt-2 block min-w-56 rounded-xl border border-gray-300 bg-white px-4 py-2 font-normal"
            >
              <option value="">Todos los orígenes</option>
              {origins.map(item => (
                <option
                  key={item.id}
                  value={item.id}
                >
                  {item.nombre}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => {
              setLoading(true)
              setRefreshVersion(value => value + 1)
            }}
            disabled={loading}
            className="rounded-xl border border-gray-300 bg-white px-4 py-2 font-normal text-gray-700 hover:bg-gray-50 disabled:text-gray-400"
          >
            {loading ? 'Consultando…' : 'Actualizar resumen'}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-4 text-red-700"
        >
          {error}
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricCard
          label="Cuentas activas"
          value={formatNumber(totals.accounts)}
          tone="orange"
        />
        <MetricCard
          label="Asignadas"
          value={formatNumber(totals.assigned)}
          tone="green"
        />
        <MetricCard
          label="Sin asignar"
          value={formatNumber(totals.unassigned)}
          tone="red"
        />
        <MetricCard
          label="Campañas"
          value={formatNumber(totals.campaigns)}
          tone="purple"
        />
        <MetricCard
          label="Saldo total"
          value={formatMoney(totals.balance)}
          tone="blue"
        />
        <MetricCard
          label="Pago requerido"
          value={formatMoney(totals.requiredPayment)}
          tone="gray"
        />
      </div>

      {Number(totals.accounts) === 0 && !loading && !error && (
        <div className="mt-6 rounded-2xl border border-orange-200 bg-orange-50 p-5 text-orange-800">
          El resumen se llenará automáticamente cuando exista una
          cartera importada para el origen seleccionado.
        </div>
      )}

      <CarteraAlerts
        key={`${selectedOriginId}:${refreshVersion}`}
        originId={selectedOriginId}
        refreshVersion={refreshVersion}
        onOpenAccount={onOpenAccount}
      />

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <article className="rounded-3xl bg-white p-6 shadow">
          <h3 className="text-xl font-bold">
            Estados de gestión
          </h3>
          <p className="mb-5 mt-1 text-sm text-gray-500">
            Distribución de cuentas activas.
          </p>
          <DistributionList
            items={states}
            labelKey="state"
            labelFor={value => (
              CARTERA_ESTADO_LABEL[value]
              || value
              || 'Sin gestionar'
            )}
            emptyMessage="No hay estados para mostrar."
            colorClass="bg-orange-500"
          />
        </article>

        <article className="rounded-3xl bg-white p-6 shadow">
          <h3 className="text-xl font-bold">
            Nivel de riesgo
          </h3>
          <p className="mb-5 mt-1 text-sm text-gray-500">
            Concentración por clasificación bancaria.
          </p>
          <DistributionList
            items={risks}
            labelKey="risk"
            labelFor={value => value || 'Sin nivel'}
            emptyMessage="No hay niveles de riesgo para mostrar."
            colorClass="bg-red-500"
          />
        </article>

        <article className="overflow-hidden rounded-3xl bg-white shadow">
          <div className="p-6">
            <h3 className="text-xl font-bold">
              Carga por ejecutivo
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Cuentas activas bajo el alcance del usuario.
            </p>
          </div>

          {executives.length === 0 ? (
            <p className="mx-6 mb-6 rounded-xl bg-gray-50 p-4 text-sm text-gray-500">
              No hay asignaciones para mostrar.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="px-6 py-3">Ejecutivo</th>
                    <th className="px-6 py-3 text-right">Cuentas</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {executives.map(item => (
                    <tr key={item.id || 'sin-asignar'}>
                      <td className="px-6 py-3 font-normal">
                        {item.name || 'Sin asignar'}
                      </td>
                      <td className="px-6 py-3 text-right font-normal">
                        {formatNumber(item.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>
    </section>
  )
}
