import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'

import { apiFetch } from './api'
import CarteraDrawer from './CarteraDrawer'

import {
  GESTION_CANALES,
  GESTION_RELACIONES,
  formatDate,
  formatDateTime,
  formatMoney
} from './cartera.constants'

const EMPTY_FILTERS = {
  busqueda: '',
  resultado: '',
  ejecutivo: '',
  origen: '',
  desde: '',
  hasta: ''
}

function buildQuery(filters, page) {
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

async function readJson(response, fallback) {
  const data = await response
    .json()
    .catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.error || fallback)
  }

  return data
}

function mapLabels(items) {
  return Object.fromEntries(
    items.map(item => [item.value, item.label])
  )
}

function PriorityBadge({ value }) {
  const styles = {
    1: 'bg-red-100 text-red-700',
    2: 'bg-orange-100 text-orange-700',
    3: 'bg-amber-100 text-amber-800',
    4: 'bg-gray-100 text-gray-700'
  }

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
        styles[value] || styles[4]
      }`}
    >
      P{value || '—'}
    </span>
  )
}

export default function CarteraGestiones({ usuario }) {
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
  const [typifications, setTypifications] = useState([])
  const [executives, setExecutives] = useState([])
  const [origins, setOrigins] = useState([])
  const [selectedAccountId, setSelectedAccountId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [resolvingId, setResolvingId] = useState(null)
  const [reviewNotes, setReviewNotes] = useState({})
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  const channelLabels = useMemo(
    () => mapLabels(GESTION_CANALES),
    []
  )
  const relationshipLabels = useMemo(
    () => mapLabels(GESTION_RELACIONES),
    []
  )

  const loadManagements = useCallback(async signal => {
    setLoading(true)
    setError('')

    try {
      const query = buildQuery(filters, page)
      const response = await apiFetch(
        `/crm-api/cartera/gestiones?${query}`,
        { signal }
      )
      const data = await readJson(
        response,
        'No fue posible consultar las gestiones'
      )

      if (
        !Array.isArray(data.data)
        || !data.pagination
      ) {
        throw new Error(
          'La respuesta de gestiones no tiene el formato esperado'
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
  }, [filters, page])

  useEffect(() => {
    const controller = new AbortController()

    // La consulta remota actualiza el listado visible.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadManagements(controller.signal)

    return () => controller.abort()
  }, [loadManagements, refreshVersion])

  useEffect(() => {
    let active = true

    Promise.all([
      apiFetch('/crm-api/cartera/tipificaciones')
        .then(response => readJson(
          response,
          'No fue posible consultar las tipificaciones'
        )),
      apiFetch('/crm-api/cartera/ejecutivos')
        .then(response => readJson(
          response,
          'No fue posible consultar los ejecutivos'
        )),
      apiFetch('/crm-api/cartera/origenes')
        .then(response => readJson(
          response,
          'No fue posible consultar los orígenes'
        ))
    ])
      .then(([catalog, users, sourceOrigins]) => {
        if (!active) {
          return
        }

        setTypifications(
          Array.isArray(catalog?.data) ? catalog.data : []
        )
        setExecutives(
          Array.isArray(users) ? users : []
        )
        setOrigins(
          Array.isArray(sourceOrigins) ? sourceOrigins : []
        )
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

  const updateDraft = event => {
    const { name, value } = event.target

    setDraftFilters(current => ({
      ...current,
      [name]: value
    }))
  }

  const applyFilters = event => {
    event.preventDefault()
    setPage(1)
    setFilters({ ...draftFilters })
  }

  const clearFilters = () => {
    setDraftFilters(EMPTY_FILTERS)
    setFilters(EMPTY_FILTERS)
    setPage(1)
  }

  const refresh = useCallback(() => {
    setRefreshVersion(value => value + 1)
  }, [])

  const resolvePayment = async (row, decision) => {
    const notes = String(reviewNotes[row.id] || '').trim()

    if (decision === 'rechazar' && !notes) {
      setError('Indique el motivo para rechazar el pago reportado.')
      return
    }

    const action = decision === 'aprobar' ? 'aprobar' : 'rechazar'

    if (!window.confirm(
      `¿Confirma ${action} el pago reportado de ${row.cliente_nombre || row.id_cliente}?`
    )) {
      return
    }

    setResolvingId(row.id)
    setError('')
    setMessage('')

    try {
      const response = await apiFetch(
        `/crm-api/cartera/pagos/${row.pago_validacion_id}/validacion`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            decision,
            notas: notes || null
          })
        }
      )

      await readJson(
        response,
        'No fue posible resolver la validación de pago'
      )

      setMessage(
        decision === 'aprobar'
          ? 'Pago aprobado. La cuenta quedó cerrada y auditada.'
          : 'Pago rechazado. La cuenta regresó a su estado anterior.'
      )
      setReviewNotes(current => ({
        ...current,
        [row.id]: ''
      }))
      refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setResolvingId(null)
    }
  }

  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-orange-600">
            SUPERVISIÓN DE CARTERA
          </p>
          <h1 className="mt-1 text-4xl font-bold">
            Gestiones
          </h1>
          <p className="mt-2 text-gray-500">
            Consulta la actividad registrada por los ejecutivos.
          </p>
        </div>

        <div className="rounded-2xl border border-orange-200 bg-orange-50 px-5 py-3">
          <p className="text-xs font-bold uppercase text-orange-700">
            Total de gestiones
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
            Búsqueda
            <input
              name="busqueda"
              type="search"
              value={draftFilters.busqueda}
              onChange={updateDraft}
              placeholder="Cliente, folio, teléfono o notas"
              className="mt-2 w-full rounded-xl border p-3 font-normal"
            />
          </label>

          <label className="text-sm font-normal">
            Tipificación
            <select
              name="resultado"
              value={draftFilters.resultado}
              onChange={updateDraft}
              className="mt-2 w-full rounded-xl border bg-white p-3 font-normal"
            >
              <option value="">Todas las tipificaciones</option>
              {typifications.map(item => (
                <option key={item.id} value={item.codigo}>
                  P{item.prioridad} · {item.nombre}
                </option>
              ))}
            </select>
          </label>

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
                <option key={item.id} value={item.id}>
                  {item.nombre}
                </option>
              ))}
            </select>
          </label>

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
                <option key={item.id} value={item.id}>
                  {item.nombre}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-normal">
            Desde
            <input
              name="desde"
              type="date"
              value={draftFilters.desde}
              onChange={updateDraft}
              className="mt-2 w-full rounded-xl border p-3 font-normal"
            />
          </label>

          <label className="text-sm font-normal">
            Hasta
            <input
              name="hasta"
              type="date"
              value={draftFilters.hasta}
              onChange={updateDraft}
              className="mt-2 w-full rounded-xl border p-3 font-normal"
            />
          </label>
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

      {message && (
        <div
          role="status"
          className="mt-6 rounded-2xl border border-green-300 bg-green-50 p-4 text-green-700"
        >
          {message}
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-3xl bg-white shadow">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
          <div>
            <h2 className="text-xl font-bold">
              Historial de gestiones
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
            <p className="text-5xl">🗂️</p>
            <h3 className="mt-4 text-xl font-bold">
              Todavía no hay gestiones registradas
            </h3>
            <p className="mx-auto mt-2 max-w-2xl text-gray-500">
              Las gestiones aparecerán aquí cuando los ejecutivos
              registren actividad desde el detalle de una cuenta.
            </p>
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-[1750px] w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-4">Fecha</th>
                  <th className="p-4">Cliente / cuenta</th>
                  <th className="p-4">Tipificación</th>
                  <th className="p-4">Contacto</th>
                  <th className="p-4">Promesa</th>
                  <th className="p-4">Seguimiento</th>
                  <th className="p-4">Ejecutivo</th>
                  <th className="p-4">Notas</th>
                  <th className="p-4">Validación de pago</th>
                  <th className="p-4">Acción</th>
                </tr>
              </thead>

              <tbody className="divide-y align-top">
                {rows.map(row => (
                  <tr
                    key={row.id}
                    className={
                      row.pago_validacion_estado === 'pendiente'
                        ? 'bg-amber-50 hover:bg-amber-100/60'
                        : 'hover:bg-orange-50/40'
                    }
                  >
                    <td className="p-4 whitespace-nowrap">
                      {formatDateTime(row.creada_at)}
                    </td>
                    <td className="p-4">
                      <p className="font-normal">
                        {row.cliente_nombre || 'Sin nombre'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {row.origen_nombre || 'Sin origen'} · {row.id_cliente}
                      </p>
                      <p className="text-xs text-gray-500">
                        Folio: {row.folio || '—'}
                      </p>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <PriorityBadge value={row.prioridad} />
                        <span className="font-normal">
                          {row.tipificacion_nombre}
                        </span>
                      </div>
                      {row.codigo_resultado && (
                        <p className="mt-1 text-xs text-gray-500">
                          Código: {row.codigo_resultado}
                        </p>
                      )}
                    </td>
                    <td className="p-4">
                      <p>{channelLabels[row.canal] || row.canal}</p>
                      <p className="text-xs text-gray-500">
                        {row.telefono_contactado || 'Sin teléfono'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {row.persona_contactada || 'Sin contacto'}
                        {row.relacion_contacto
                          ? ` · ${relationshipLabels[row.relacion_contacto] || row.relacion_contacto}`
                          : ''}
                      </p>
                    </td>
                    <td className="p-4">
                      <p className="font-normal">
                        {formatMoney(row.promesa_monto)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatDate(row.promesa_fecha)}
                      </p>
                      {row.promesa_estado && (
                        <p className="text-xs text-gray-500">
                          {row.promesa_estado}
                        </p>
                      )}
                    </td>
                    <td className="p-4">
                      <p>{formatDateTime(row.proximo_seguimiento_at)}</p>
                      {row.seguimiento_estado && (
                        <p className="text-xs text-gray-500">
                          {row.seguimiento_estado}
                        </p>
                      )}
                    </td>
                    <td className="p-4">
                      {row.gestor_nombre || 'Sin identificar'}
                    </td>
                    <td className="p-4 max-w-xs">
                      <p className="line-clamp-3">
                        {row.notas || row.evidencia || '—'}
                      </p>
                      {row.evidencia && (
                        <p className="mt-2 text-xs font-bold text-blue-700">
                          Evidencia: {row.evidencia}
                        </p>
                      )}
                    </td>
                    <td className="p-4 min-w-72">
                      {!row.pago_validacion_estado && '—'}

                      {row.pago_validacion_estado === 'pendiente' && (
                        <div>
                          <span className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                            Pago pendiente de validar
                          </span>
                          <textarea
                            value={reviewNotes[row.id] || ''}
                            onChange={event => setReviewNotes(current => ({
                              ...current,
                              [row.id]: event.target.value
                            }))}
                            maxLength={1000}
                            rows={2}
                            placeholder="Nota de revisión; obligatoria al rechazar"
                            className="mt-3 w-full rounded-lg border bg-white p-2 text-sm"
                          />
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              disabled={resolvingId === row.id}
                              onClick={() => resolvePayment(row, 'aprobar')}
                              className="rounded-lg bg-green-600 px-3 py-2 font-bold text-white hover:bg-green-700 disabled:opacity-50"
                            >
                              Aprobar y cerrar
                            </button>
                            <button
                              type="button"
                              disabled={resolvingId === row.id}
                              onClick={() => resolvePayment(row, 'rechazar')}
                              className="rounded-lg bg-red-600 px-3 py-2 font-bold text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              Rechazar
                            </button>
                          </div>
                        </div>
                      )}

                      {row.pago_validacion_estado === 'aprobado' && (
                        <div>
                          <span className="inline-flex rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">
                            Pago aprobado
                          </span>
                          <p className="mt-2 text-xs text-gray-500">
                            {row.pago_revisor_nombre || 'Administrador'} · {formatDateTime(row.pago_revisado_at)}
                          </p>
                          {row.pago_validacion_notas && (
                            <p className="mt-1 text-xs text-gray-600">
                              {row.pago_validacion_notas}
                            </p>
                          )}
                        </div>
                      )}

                      {row.pago_validacion_estado === 'rechazado' && (
                        <div>
                          <span className="inline-flex rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">
                            Pago rechazado
                          </span>
                          <p className="mt-2 text-xs text-gray-500">
                            {row.pago_revisor_nombre || 'Administrador'} · {formatDateTime(row.pago_revisado_at)}
                          </p>
                          <p className="mt-1 text-xs text-gray-600">
                            {row.pago_validacion_notas || 'Sin nota'}
                          </p>
                        </div>
                      )}
                    </td>
                    <td className="p-4">
                      <button
                        type="button"
                        onClick={() => setSelectedAccountId(row.cuenta_id)}
                        className="rounded-lg bg-gray-900 px-4 py-2 font-normal text-white hover:bg-orange-600"
                      >
                        Abrir cuenta
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

      {selectedAccountId && (
        <CarteraDrawer
          accountId={selectedAccountId}
          usuario={usuario}
          executives={executives}
          onClose={() => setSelectedAccountId(null)}
          onChanged={refresh}
        />
      )}
    </section>
  )
}
