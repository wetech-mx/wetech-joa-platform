import { useCallback, useEffect, useState } from 'react'

import { apiFetch } from './api'

const PRIORITIES = [
  ['baja', 'Baja'],
  ['media', 'Media'],
  ['alta', 'Alta'],
  ['urgente', 'Urgente']
]

const STATES = [
  ['nuevo', 'Nuevo'],
  ['en_proceso', 'En proceso'],
  ['en_espera', 'En espera'],
  ['resuelto', 'Resuelto'],
  ['cerrado', 'Cerrado']
]

const EMPTY_FORM = {
  cuenta_id: '',
  titulo: '',
  prioridad: 'media',
  estado: 'nuevo',
  asignado_a: '',
  comentarios: '',
  solucion: '',
  version: ''
}

async function readJson(response, fallback) {
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = new Error(data.error || fallback)
    error.code = data.code
    throw error
  }

  return data
}

function formatDateTime(value) {
  if (!value) return '—'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City'
  }).format(date)
}

function label(options, value) {
  return options.find(item => item[0] === value)?.[1] || value
}

export default function CarteraCases({ usuario }) {
  const isAdministrator = usuario?.rol !== 'Ejecutivo'
  const [cases, setCases] = useState([])
  const [executives, setExecutives] = useState([])
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [history, setHistory] = useState([])
  const [accountSearch, setAccountSearch] = useState('')
  const [accountResults, setAccountResults] = useState([])
  const [searchingAccounts, setSearchingAccounts] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const loadCases = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const query = statusFilter
        ? `?estado=${encodeURIComponent(statusFilter)}`
        : ''
      const response = await apiFetch(`/crm-api/cartera/casos${query}`)
      const data = await readJson(
        response,
        'No fue posible consultar los casos'
      )

      setCases(Array.isArray(data) ? data : [])
    } catch (requestError) {
      setCases([])
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    const timer = window.setTimeout(loadCases, 0)
    return () => window.clearTimeout(timer)
  }, [loadCases])

  useEffect(() => {
    if (!isAdministrator) return undefined

    apiFetch('/crm-api/cartera/ejecutivos')
      .then(response => readJson(
        response,
        'No fue posible consultar los Ejecutivos'
      ))
      .then(data => setExecutives(Array.isArray(data) ? data : []))
      .catch(requestError => setError(requestError.message))

    return undefined
  }, [isAdministrator])

  function updateForm(field, value) {
    setForm(current => ({ ...current, [field]: value }))
  }

  function startCreate() {
    setEditingId(null)
    setHistory([])
    setForm({
      ...EMPTY_FORM,
      asignado_a: isAdministrator ? '' : String(usuario?.id || '')
    })
    setAccountSearch('')
    setAccountResults([])
    setShowForm(true)
    setError('')
    setMessage('')
  }

  async function searchAccounts(event) {
    event.preventDefault()
    const text = accountSearch.trim()

    if (text.length < 2) {
      setError('Escriba al menos dos caracteres para buscar la cuenta.')
      return
    }

    setSearchingAccounts(true)
    setError('')

    try {
      const query = new URLSearchParams({
        busqueda: text,
        page: '1',
        limit: '10',
        activa: 'true'
      })
      const response = await apiFetch(`/crm-api/cartera?${query}`)
      const data = await readJson(
        response,
        'No fue posible buscar la cuenta'
      )

      setAccountResults(Array.isArray(data?.data) ? data.data : [])
    } catch (requestError) {
      setAccountResults([])
      setError(requestError.message)
    } finally {
      setSearchingAccounts(false)
    }
  }

  async function editCase(item) {
    setError('')
    setMessage('')

    try {
      const response = await apiFetch(`/crm-api/cartera/casos/${item.id}`)
      const data = await readJson(
        response,
        'No fue posible consultar el caso'
      )
      const record = data.case

      setEditingId(String(record.id))
      setForm({
        cuenta_id: String(record.cuenta_id),
        titulo: record.titulo || '',
        prioridad: record.prioridad || 'media',
        estado: record.estado || 'nuevo',
        asignado_a: String(record.asignado_a || ''),
        comentarios: record.comentarios || '',
        solucion: record.solucion || '',
        version: String(record.version || '')
      })
      setAccountSearch(
        `${record.cliente_nombre || 'Cuenta'} · ${record.folio || record.cuenta_id}`
      )
      setHistory(Array.isArray(data.history) ? data.history : [])
      setShowForm(true)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  async function saveCase(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')

    try {
      const isEditing = Boolean(editingId)
      const response = await apiFetch(
        isEditing
          ? `/crm-api/cartera/casos/${editingId}`
          : '/crm-api/cartera/casos',
        {
          method: isEditing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            cuenta_id: form.cuenta_id,
            asignado_a: isAdministrator
              ? form.asignado_a
              : undefined,
            version: isEditing ? form.version : undefined
          })
        }
      )

      await readJson(
        response,
        isEditing
          ? 'No fue posible actualizar el caso'
          : 'No fue posible crear el caso'
      )

      setMessage(
        isEditing
          ? 'Caso actualizado correctamente.'
          : 'Caso creado correctamente.'
      )
      setShowForm(false)
      await loadCases()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-orange-600">OPERACIÓN</p>
          <h1 className="mt-1 text-4xl font-bold">Casos</h1>
          <p className="mt-2 text-gray-500">
            Registre pendientes ligados a una cuenta con fecha automática e historial.
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="rounded-xl bg-orange-600 px-5 py-3 text-white"
        >
          Crear caso
        </button>
      </div>

      {message && (
        <p className="rounded-xl border border-green-200 bg-green-50 p-4 text-green-700">
          {message}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </p>
      )}

      <div className="rounded-3xl bg-white p-5 shadow-sm">
        <label className="block max-w-sm text-sm">
          Estado
          <select
            value={statusFilter}
            onChange={event => setStatusFilter(event.target.value)}
            className="mt-2 w-full rounded-xl border bg-white p-3"
          >
            <option value="">Todos</option>
            {STATES.map(item => (
              <option key={item[0]} value={item[0]}>{item[1]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-hidden rounded-3xl bg-white shadow-sm">
        {loading ? (
          <p className="p-8 text-center text-gray-500">Consultando casos…</p>
        ) : cases.length === 0 ? (
          <p className="p-10 text-center text-gray-500">No hay casos para mostrar.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full text-left text-sm">
              <thead className="border-b bg-gray-50">
                <tr>
                  <th className="p-4">Caso</th>
                  <th className="p-4">Cuenta</th>
                  <th className="p-4">Prioridad</th>
                  <th className="p-4">Estado</th>
                  <th className="p-4">Responsable</th>
                  <th className="p-4">Modificación automática</th>
                  <th className="p-4">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {cases.map(item => (
                  <tr key={item.id}>
                    <td className="p-4">
                      <p className="font-bold">#{item.id} · {item.titulo}</p>
                      <p className="mt-1 max-w-72 truncate text-xs text-gray-500">
                        {item.comentarios}
                      </p>
                    </td>
                    <td className="p-4">
                      <p>{item.cliente_nombre || 'Sin nombre'}</p>
                      <p className="text-xs text-gray-500">
                        {item.campania_nombre} · {item.folio || 'Sin folio'}
                      </p>
                    </td>
                    <td className="p-4">{label(PRIORITIES, item.prioridad)}</td>
                    <td className="p-4">{label(STATES, item.estado)}</td>
                    <td className="p-4">{item.asignado_nombre}</td>
                    <td className="p-4">{formatDateTime(item.actualizado_at)}</td>
                    <td className="p-4">
                      <button
                        type="button"
                        onClick={() => editCase(item)}
                        className="rounded-lg bg-gray-900 px-4 py-2 text-white"
                      >
                        Consultar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4">
          <div className="mx-auto my-6 max-w-3xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold">
                  {editingId ? `Caso #${editingId}` : 'Crear caso'}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  La fecha de modificación se asigna automáticamente al guardar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg bg-gray-900 px-4 py-2 text-white"
              >
                Cerrar
              </button>
            </div>

            {!editingId && (
              <div className="mt-6 rounded-2xl border bg-gray-50 p-4">
                <form onSubmit={searchAccounts} className="flex gap-2">
                  <input
                    value={accountSearch}
                    onChange={event => setAccountSearch(event.target.value)}
                    placeholder="Nombre, folio, cliente o teléfono"
                    className="min-w-0 flex-1 rounded-xl border bg-white p-3"
                  />
                  <button
                    disabled={searchingAccounts}
                    className="rounded-xl bg-blue-700 px-4 text-white disabled:bg-gray-300"
                  >
                    Buscar
                  </button>
                </form>
                {accountResults.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {accountResults.map(account => (
                      <button
                        key={account.id}
                        type="button"
                        onClick={() => {
                          updateForm('cuenta_id', String(account.id))
                          setAccountSearch(
                            `${account.nombre || 'Cuenta'} · ${account.folio || account.id}`
                          )
                          setAccountResults([])
                        }}
                        className={`block w-full rounded-xl border p-3 text-left ${
                          String(account.id) === form.cuenta_id
                            ? 'border-blue-500 bg-blue-50'
                            : 'bg-white'
                        }`}
                      >
                        <span className="font-bold">{account.nombre || 'Sin nombre'}</span>
                        <span className="block text-xs text-gray-500">
                          {account.campania_nombre || account.id_campania} · {account.folio}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <form onSubmit={saveCase} className="mt-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-bold sm:col-span-2">
                  Título
                  <input
                    required
                    maxLength={200}
                    value={form.titulo}
                    onChange={event => updateForm('titulo', event.target.value)}
                    className="mt-1 w-full rounded-xl border p-3 font-normal"
                  />
                </label>
                <label className="text-sm font-bold">
                  Prioridad
                  <select
                    value={form.prioridad}
                    onChange={event => updateForm('prioridad', event.target.value)}
                    className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
                  >
                    {PRIORITIES.map(item => (
                      <option key={item[0]} value={item[0]}>{item[1]}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-bold">
                  Estado
                  <select
                    value={form.estado}
                    onChange={event => updateForm('estado', event.target.value)}
                    className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
                  >
                    {STATES.map(item => (
                      <option key={item[0]} value={item[0]}>{item[1]}</option>
                    ))}
                  </select>
                </label>
                {isAdministrator && (
                  <label className="text-sm font-bold sm:col-span-2">
                    Responsable
                    <select
                      required
                      value={form.asignado_a}
                      onChange={event => updateForm('asignado_a', event.target.value)}
                      className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
                    >
                      <option value="">Seleccione un Ejecutivo</option>
                      {executives.map(item => (
                        <option key={item.id} value={item.id}>{item.nombre}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <label className="block text-sm font-bold">
                Comentarios
                <textarea
                  required
                  maxLength={5000}
                  rows={4}
                  value={form.comentarios}
                  onChange={event => updateForm('comentarios', event.target.value)}
                  className="mt-1 w-full rounded-xl border p-3 font-normal"
                />
              </label>
              <label className="block text-sm font-bold">
                Solución
                <textarea
                  required={form.estado === 'resuelto' || form.estado === 'cerrado'}
                  maxLength={5000}
                  rows={3}
                  value={form.solucion}
                  onChange={event => updateForm('solucion', event.target.value)}
                  placeholder="Obligatoria al resolver o cerrar"
                  className="mt-1 w-full rounded-xl border p-3 font-normal"
                />
              </label>
              <button
                type="submit"
                disabled={saving || (!editingId && !form.cuenta_id)}
                className="rounded-xl bg-orange-600 px-5 py-3 text-white disabled:bg-gray-300"
              >
                {saving ? 'Guardando…' : 'Guardar caso'}
              </button>
            </form>

            {editingId && history.length > 0 && (
              <section className="mt-8 border-t pt-6">
                <h3 className="text-lg font-bold">Historial del caso</h3>
                <div className="mt-3 space-y-3">
                  {history.map(item => (
                    <article key={item.id} className="rounded-xl border p-3 text-sm">
                      <p className="font-bold">
                        {item.evento} · {item.usuario_nombre || 'Sistema'}
                      </p>
                      <p className="text-gray-500">
                        {formatDateTime(item.creada_at)} · Sección {item.seccion}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
