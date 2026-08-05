import {
  useCallback,
  useEffect,
  useState
} from 'react'

import { apiFetch } from './api'
import CarteraDrawer from './CarteraDrawer'

import {
  CARTERA_ESTADOS,
  CARTERA_ESTADO_LABEL,
  formatDate,
  formatMoney
} from './cartera.constants'

const EMPTY_FILTERS = {
  busqueda: '',
  origen: '',
  campania: '',
  ejecutivo: '',
  estado: '',
  riesgo: '',
  fecha: ''
}

function buildQuery(
  filters,
  page
) {
  const params = new URLSearchParams({
    page: String(page),
    limit: '25'
  })

  for (const [key, value] of Object.entries(filters)) {
    const normalized = String(value || '').trim()

    if (normalized) {
      params.set(key, normalized)
    }
  }

  return params.toString()
}

async function readJson(
  response,
  fallback
) {
  const data = await response
    .json()
    .catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.error || fallback)
  }

  return data
}

function StateBadge({ value }) {
  const styles = {
    sin_gestionar: 'bg-gray-100 text-gray-700',
    contactado: 'bg-blue-100 text-blue-700',
    no_localizado: 'bg-amber-100 text-amber-800',
    seguimiento: 'bg-purple-100 text-purple-700',
    promesa_pago: 'bg-orange-100 text-orange-800',
    promesa_incumplida: 'bg-red-100 text-red-700',
    convenio: 'bg-indigo-100 text-indigo-700',
    pago_realizado: 'bg-green-100 text-green-700',
    rechazo_pago: 'bg-rose-100 text-rose-700',
    datos_incorrectos: 'bg-yellow-100 text-yellow-800',
    cerrado: 'bg-slate-200 text-slate-700'
  }

  return (
    <span
      className={`
        inline-flex
        rounded-full
        px-3
        py-1
        text-xs
        font-normal
        ${styles[value] || styles.sin_gestionar}
      `}
    >
      {CARTERA_ESTADO_LABEL[value] || value || 'Sin gestionar'}
    </span>
  )
}

export default function Cartera({
  usuario
}) {
  const [draftFilters, setDraftFilters] = useState(
    EMPTY_FILTERS
  )
  const [filters, setFilters] = useState(
    EMPTY_FILTERS
  )
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0
  })
  const [executives, setExecutives] = useState([])
  const [origins, setOrigins] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  const isExecutive =
    usuario?.rol === 'Ejecutivo'

  const selectedOrigin = origins.find(
    item => String(item.id) === String(filters.origen)
  )

  const loadPortfolio = useCallback(async signal => {
    setLoading(true)
    setError('')

    try {
      const query = buildQuery(filters, page)
      const response = await apiFetch(
        `/crm-api/cartera?${query}`,
        {
          signal
        }
      )
      const data = await readJson(
        response,
        'No fue posible consultar la cartera'
      )

      if (
        !Array.isArray(data.data)
        || !data.pagination
      ) {
        throw new Error(
          'La respuesta de cartera no tiene el formato esperado'
        )
      }

      setRows(data.data)
      setPagination(data.pagination)
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        setRows([])
        setError(requestError.message)
      }
    } finally {
      if (!signal.aborted) {
        setLoading(false)
      }
    }
  }, [
    filters,
    page
  ])

  useEffect(() => {
    const controller = new AbortController()

    // La carga remota actualiza el estado con la respuesta de la API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPortfolio(controller.signal)

    return () => controller.abort()
  }, [
    loadPortfolio,
    refreshVersion
  ])

  useEffect(() => {
    let active = true

    apiFetch('/crm-api/cartera/origenes')
      .then(response => readJson(
        response,
        'No fue posible consultar los orígenes'
      ))
      .then(data => {
        if (active && Array.isArray(data)) {
          setOrigins(data)
        }
      })
      .catch(requestError => {
        if (active) {
          setError(current => (
            current || requestError.message
          ))
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (isExecutive) {
      return undefined
    }

    let active = true

    apiFetch('/crm-api/cartera/ejecutivos')
      .then(response => readJson(
        response,
        'No fue posible consultar los ejecutivos'
      ))
      .then(data => {
        if (active && Array.isArray(data)) {
          setExecutives(data)
        }
      })
      .catch(requestError => {
        if (active) {
          setError(current => (
            current || requestError.message
          ))
        }
      })

    return () => {
      active = false
    }
  }, [isExecutive])

  const applyFilters = event => {
    event.preventDefault()
    setPage(1)
    setFilters({
      ...draftFilters
    })
  }

  const clearFilters = () => {
    setDraftFilters(EMPTY_FILTERS)
    setFilters(EMPTY_FILTERS)
    setPage(1)
  }

  const refresh = useCallback(() => {
    setRefreshVersion(value => value + 1)
  }, [])

  const updateDraft = event => {
    const {
      name,
      value
    } = event.target

    setDraftFilters(current => ({
      ...current,
      [name]: value
    }))
  }

  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-orange-600">
            MÓDULO V0.7.0
          </p>
          <h1 className="mt-1 text-4xl font-bold">
            {selectedOrigin
              ? `Cartera · ${selectedOrigin.nombre}`
              : 'Cartera'}
          </h1>
          <p className="mt-2 text-gray-500">
            Consulta, filtra y gestiona las cuentas asignadas.
          </p>
        </div>

        <div className="rounded-2xl border border-orange-200 bg-orange-50 px-5 py-3">
          <p className="text-xs font-bold uppercase text-orange-700">
            Total de cuentas
          </p>
          <p className="text-3xl font-normal text-orange-700">
            {pagination.total}
          </p>
        </div>
      </div>

      <form
        onSubmit={applyFilters}
        className="mt-8 rounded-3xl bg-white p-6 shadow"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-sm font-normal">
            Origen
            <select
              name="origen"
              value={draftFilters.origen}
              onChange={updateDraft}
              className="mt-2 w-full rounded-xl border bg-white p-3 font-normal"
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

          <label className="text-sm font-normal">
            Búsqueda
            <input
              name="busqueda"
              type="search"
              value={draftFilters.busqueda}
              onChange={updateDraft}
              placeholder="Nombre, folio, cliente o teléfono"
              className="mt-2 w-full rounded-xl border p-3 font-normal"
            />
          </label>

          <label className="text-sm font-normal">
            Campaña
            <input
              name="campania"
              value={draftFilters.campania}
              onChange={updateDraft}
              placeholder="Identificador de campaña"
              className="mt-2 w-full rounded-xl border p-3 font-normal"
            />
          </label>

          <label className="text-sm font-normal">
            Estado
            <select
              name="estado"
              value={draftFilters.estado}
              onChange={updateDraft}
              className="mt-2 w-full rounded-xl border bg-white p-3 font-normal"
            >
              <option value="">Todos los estados</option>
              {CARTERA_ESTADOS.map(item => (
                <option
                  key={item.value}
                  value={item.value}
                >
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-normal">
            Nivel de riesgo
            <input
              name="riesgo"
              value={draftFilters.riesgo}
              onChange={updateDraft}
              placeholder="Nivel de riesgo"
              className="mt-2 w-full rounded-xl border p-3 font-normal"
            />
          </label>

          <label className="text-sm font-normal">
            Fecha de cartera
            <input
              name="fecha"
              type="date"
              value={draftFilters.fecha}
              onChange={updateDraft}
              className="mt-2 w-full rounded-xl border p-3 font-normal"
            />
          </label>

          {!isExecutive && (
            <label className="text-sm font-normal">
              Ejecutivo
              <select
                name="ejecutivo"
                value={draftFilters.ejecutivo}
                onChange={updateDraft}
                className="mt-2 w-full rounded-xl border bg-white p-3 font-normal"
              >
                <option value="">Todos los ejecutivos</option>
                {executives.map(item => (
                  <option
                    key={item.id}
                    value={item.id}
                  >
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
            className="rounded-xl bg-orange-600 px-5 py-3 font-normal text-white hover:bg-orange-700"
          >
            Aplicar filtros
          </button>

          <button
            type="button"
            onClick={clearFilters}
            className="rounded-xl bg-gray-200 px-5 py-3 font-normal text-gray-700 hover:bg-gray-300"
          >
            Limpiar
          </button>

          <button
            type="button"
            onClick={refresh}
            className="rounded-xl border border-gray-300 px-5 py-3 font-normal text-gray-700 hover:bg-gray-50"
          >
            Actualizar
          </button>
        </div>
      </form>

      {error && (
        <div
          role="alert"
          className="mt-6 rounded-2xl border border-red-300 bg-red-50 p-4 text-red-700"
        >
          {error}
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-3xl bg-white shadow">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
          <div>
            <h2 className="text-xl font-bold">
              Cuentas
            </h2>
            <p className="text-sm text-gray-500">
              Página {pagination.page}
              {pagination.totalPages > 0
                ? ` de ${pagination.totalPages}`
                : ''}
            </p>
          </div>

          {loading && (
            <p className="text-sm font-bold text-orange-600">
              Consultando…
            </p>
          )}
        </div>

        {!loading && rows.length === 0 && (
          <div className="px-6 py-16 text-center">
            <p className="text-5xl">📂</p>
            <h3 className="mt-4 text-xl font-bold">
              No hay cuentas para mostrar
            </h3>
            <p className="mt-2 text-gray-500">
              La cartera aparecerá aquí cuando exista una importación
              para el origen seleccionado o cuando los filtros
              encuentren resultados.
            </p>
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-[1280px] w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-4">Cliente</th>
                  <th className="p-4">Origen</th>
                  <th className="p-4">Campaña / folio</th>
                  <th className="p-4">Riesgo</th>
                  <th className="p-4">Atraso</th>
                  <th className="p-4">Saldo</th>
                  <th className="p-4">Ejecutivo</th>
                  <th className="p-4">Estado</th>
                  <th className="p-4">Fecha</th>
                  <th className="p-4">Acción</th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {rows.map(row => (
                  <tr
                    key={row.id}
                    className="hover:bg-orange-50/40"
                  >
                    <td className="p-4">
                      <p className="font-normal">
                        {row.nombre || 'Sin nombre'}
                      </p>
                      <p className="text-xs text-gray-500">
                        ID cliente: {row.id_cliente}
                      </p>
                    </td>
                    <td className="p-4">
                      <p className="font-normal">
                        {row.origen_nombre || 'Sin origen'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {row.origen_codigo || '—'}
                      </p>
                    </td>
                    <td className="p-4">
                      <p>{row.id_campania}</p>
                      <p className="text-xs text-gray-500">
                        Folio: {row.folio}
                      </p>
                    </td>
                    <td className="p-4">
                      {row.id_nivel_riesgo || '—'}
                    </td>
                    <td className="p-4">
                      <p>
                        {row.dias_atraso ?? '—'} días
                      </p>
                      <p className="text-xs text-gray-500">
                        {row.semanas_atraso ?? '—'} semanas
                      </p>
                    </td>
                    <td className="p-4 font-normal">
                      {formatMoney(row.saldo)}
                    </td>
                    <td className="p-4">
                      {row.ejecutivo_nombre || 'Sin asignar'}
                    </td>
                    <td className="p-4">
                      <StateBadge
                        value={row.estado_gestion}
                      />
                    </td>
                    <td className="p-4">
                      {formatDate(row.ultima_fecha_cartera)}
                    </td>
                    <td className="p-4">
                      <button
                        type="button"
                        onClick={() => setSelectedId(row.id)}
                        className="rounded-lg bg-gray-900 px-4 py-2 font-normal text-white hover:bg-orange-600"
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t p-5">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage(value => value - 1)}
            className="rounded-lg border px-4 py-2 font-normal disabled:cursor-not-allowed disabled:opacity-40"
          >
            Anterior
          </button>

          <p className="text-sm text-gray-500">
            {pagination.total} resultados
          </p>

          <button
            type="button"
            disabled={
              loading
              || pagination.totalPages === 0
              || page >= pagination.totalPages
            }
            onClick={() => setPage(value => value + 1)}
            className="rounded-lg border px-4 py-2 font-normal disabled:cursor-not-allowed disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      </div>

      {selectedId && (
        <CarteraDrawer
          accountId={selectedId}
          usuario={usuario}
          executives={executives}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
        />
      )}
    </section>
  )
}
