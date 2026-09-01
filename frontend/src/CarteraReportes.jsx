import {
  useCallback,
  useEffect,
  useState
} from 'react'

import { apiFetch } from './api'
import {
  formatDate,
  formatMoney
} from './cartera.constants'

async function readJson(response, fallback) {
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.error || fallback)
  }

  return data
}

function buildQuery(filters) {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(filters)) {
    if (String(value || '').trim()) {
      params.set(key, value)
    }
  }

  const query = params.toString()
  return query ? `?${query}` : ''
}

function fileNameFrom(response, fallback) {
  const disposition = response.headers.get('content-disposition') || ''
  return disposition.match(/filename="([^"]+)"/i)?.[1] || fallback
}

function MetricCard({ label, value, color = 'blue' }) {
  const styles = {
    blue: 'border-blue-300 bg-blue-50 text-blue-700',
    orange: 'border-orange-300 bg-orange-50 text-orange-700',
    green: 'border-green-300 bg-green-50 text-green-700',
    red: 'border-red-300 bg-red-50 text-red-700',
    gray: 'border-gray-300 bg-gray-50 text-gray-700'
  }

  return (
    <div className={`rounded-2xl border p-4 ${styles[color]}`}>
      <p className="text-xs font-bold uppercase">{label}</p>
      <p className="mt-2 text-2xl font-normal">{value}</p>
    </div>
  )
}

export default function CarteraReportes({ usuario }) {
  const isExecutive = usuario?.rol === 'Ejecutivo'
  const [origins, setOrigins] = useState([])
  const [executives, setExecutives] = useState([])
  const [cuts, setCuts] = useState([])
  const [filters, setFilters] = useState({
    origen: '',
    fecha: '',
    ejecutivo: ''
  })
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')

  const loadCuts = useCallback(async originId => {
    const query = originId
      ? `?origen=${encodeURIComponent(originId)}`
      : ''
    const response = await apiFetch(
      `/crm-api/cartera/reportes/cortes${query}`
    )
    const data = await readJson(
      response,
      'No fue posible consultar los cortes disponibles'
    )

    setCuts(Array.isArray(data) ? data : [])
    return data
  }, [])

  const loadReport = useCallback(async selectedFilters => {
    setLoading(true)
    setError('')

    try {
      const response = await apiFetch(
        `/crm-api/cartera/reportes/corte${buildQuery(selectedFilters)}`
      )
      const data = await readJson(
        response,
        'No fue posible generar el reporte del corte'
      )

      setReport(data)
      setFilters(current => ({
        ...current,
        fecha: data.date || current.fecha
      }))
    } catch (requestError) {
      setReport(null)
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const requests = [
      apiFetch('/crm-api/cartera/origenes')
        .then(response => readJson(
          response,
          'No fue posible consultar los orígenes'
        ))
    ]

    if (!isExecutive) {
      requests.push(
        apiFetch('/crm-api/cartera/ejecutivos')
          .then(response => readJson(
            response,
            'No fue posible consultar los ejecutivos'
          ))
      )
    }

    Promise.all(requests)
      .then(async ([originData, executiveData = []]) => {
        setOrigins(Array.isArray(originData) ? originData : [])
        setExecutives(
          Array.isArray(executiveData) ? executiveData : []
        )
        await loadCuts('')
        await loadReport({
          origen: '',
          fecha: '',
          ejecutivo: ''
        })
      })
      .catch(requestError => {
        setLoading(false)
        setError(requestError.message)
      })
  }, [isExecutive, loadCuts, loadReport])

  const updateFilter = async event => {
    const { name, value } = event.target
    const next = {
      ...filters,
      [name]: value
    }

    if (name === 'origen') {
      next.fecha = ''
      await loadCuts(value).catch(requestError => {
        setError(requestError.message)
      })
    }

    setFilters(next)
  }

  const consult = event => {
    event.preventDefault()
    loadReport(filters)
  }

  const download = async () => {
    setDownloading(true)
    setError('')

    try {
      const response = await apiFetch(
        `/crm-api/cartera/reportes/corte.xlsx${buildQuery(filters)}`
      )

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(
          data.error || 'No fue posible descargar el reporte'
        )
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileNameFrom(
        response,
        `Reporte_Corte_${filters.fecha || 'actual'}.xlsx`
      )
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setDownloading(false)
    }
  }

  const availableDates = [...new Set(
    cuts.map(item => String(item.fecha_cartera).slice(0, 10))
  )]

  return (
    <section className="min-w-0">
      <p className="text-sm font-bold text-orange-600">
        CONTROL OPERATIVO
      </p>
      <h1 className="mt-1 text-4xl font-bold">
        Reportes de cartera
      </h1>
      <p className="mt-2 text-gray-500">
        Consulte el corte general o el alcance de cada ejecutivo y
        descárguelo en Excel con resumen y detalle.
      </p>

      <form
        onSubmit={consult}
        className="mt-8 rounded-3xl bg-white p-6 shadow"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm font-normal">
            Origen
            <select
              name="origen"
              value={filters.origen}
              onChange={updateFilter}
              className="mt-2 w-full rounded-xl border bg-white p-3"
            >
              <option value="">Todos los orígenes</option>
              {origins.map(item => (
                <option key={item.id} value={item.id}>
                  {item.nombre}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-normal">
            Corte de cartera
            <select
              name="fecha"
              value={filters.fecha}
              onChange={updateFilter}
              className="mt-2 w-full rounded-xl border bg-white p-3"
            >
              <option value="">Último corte disponible</option>
              {availableDates.map(date => (
                <option key={date} value={date}>
                  {formatDate(date)}
                </option>
              ))}
            </select>
          </label>

          {!isExecutive && (
            <label className="text-sm font-normal">
              Ejecutivo
              <select
                name="ejecutivo"
                value={filters.ejecutivo}
                onChange={updateFilter}
                className="mt-2 w-full rounded-xl border bg-white p-3"
              >
                <option value="">Reporte general</option>
                {executives.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-orange-600 px-5 py-3 text-white disabled:bg-gray-300"
          >
            {loading ? 'Consultando…' : 'Generar reporte'}
          </button>
          <button
            type="button"
            disabled={!report || downloading}
            onClick={download}
            className="rounded-xl bg-gray-900 px-5 py-3 text-white disabled:bg-gray-300"
          >
            {downloading ? 'Preparando Excel…' : 'Descargar Excel'}
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-red-700">
          {error}
        </p>
      )}

      {report && (
        <>
          <div className="mt-6 rounded-3xl bg-white p-6 shadow">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-gray-500">Corte seleccionado</p>
                <h2 className="text-2xl font-bold">
                  {formatDate(report.date)}
                </h2>
              </div>
              <p className="text-sm text-gray-500">
                {report.origin?.nombre || 'Todos los orígenes'}
              </p>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Cuentas del corte"
                value={report.totals.accounts}
              />
              <MetricCard
                label="Sin gestión en el día"
                value={report.totals.unworked}
                color="orange"
              />
              <MetricCard
                label="Gestiones del día"
                value={report.totals.managementsToday}
                color="green"
              />
              <MetricCard
                label="Campañas"
                value={report.totals.campaigns}
                color="gray"
              />
              <MetricCard
                label="Saldo total"
                value={formatMoney(report.totals.balance)}
              />
              <MetricCard
                label="Pago requerido"
                value={formatMoney(report.totals.requiredPayment)}
                color="red"
              />
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-3xl bg-white shadow">
            <div className="border-b p-5">
              <h2 className="text-xl font-bold">
                Distribución por ejecutivo
              </h2>
              <p className="text-sm text-gray-500">
                Las gestiones corresponden al día del corte.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[950px] w-full text-sm">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="p-4">Ejecutivo</th>
                    <th className="p-4">Cuentas</th>
                    <th className="p-4">Sin gestión en el día</th>
                    <th className="p-4">Gestionadas en el día</th>
                    <th className="p-4">Gestiones del día</th>
                    <th className="p-4">Saldo</th>
                    <th className="p-4">Pago requerido</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {report.executives.map(item => (
                    <tr key={item.executiveId || 'sin-asignar'}>
                      <td className="p-4">{item.executive}</td>
                      <td className="p-4">{item.accounts}</td>
                      <td className="p-4">{item.unworked}</td>
                      <td className="p-4">{item.managedAccounts}</td>
                      <td className="p-4">{item.managementsToday}</td>
                      <td className="p-4">{formatMoney(item.balance)}</td>
                      <td className="p-4">
                        {formatMoney(item.requiredPayment)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
