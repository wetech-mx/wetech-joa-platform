import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'

import { apiFetch } from './api'

import {
  CARTERA_ESTADOS,
  CARTERA_ESTADO_LABEL
} from './cartera.constants'

const EMPTY_FORM = {
  codigo: '',
  nombre: '',
  prioridad: '4',
  estado_resultante: 'seguimiento',
  contacto_efectivo: false,
  requiere_promesa: false,
  requiere_seguimiento: false,
  cierra_cuenta: false,
  requiere_validacion_pago: false,
  orden: '100',
  activa: true
}

const RESULT_STATES = CARTERA_ESTADOS.filter(
  item => item.value !== 'sin_gestionar'
)

async function readJson(response, fallback) {
  const data = await response
    .json()
    .catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.error || fallback)
  }

  return data
}

function formFromTypification(item) {
  return {
    codigo: item.codigo,
    nombre: item.nombre,
    prioridad: String(item.prioridad),
    estado_resultante: item.estado_resultante,
    contacto_efectivo: Boolean(item.contacto_efectivo),
    requiere_promesa: Boolean(item.requiere_promesa),
    requiere_seguimiento: Boolean(item.requiere_seguimiento),
    cierra_cuenta: Boolean(item.cierra_cuenta),
    requiere_validacion_pago: Boolean(
      item.requiere_validacion_pago
    ),
    orden: String(item.orden),
    activa: Boolean(item.activa)
  }
}

function toPayload(form, includeCode = false) {
  const payload = {
    nombre: form.nombre.trim(),
    prioridad: Number(form.prioridad),
    estado_resultante: form.estado_resultante,
    contacto_efectivo: form.contacto_efectivo,
    requiere_promesa: form.requiere_promesa,
    requiere_seguimiento: form.requiere_seguimiento,
    cierra_cuenta: form.cierra_cuenta,
    requiere_validacion_pago: form.requiere_validacion_pago,
    orden: Number(form.orden),
    activa: form.activa
  }

  if (includeCode) {
    payload.codigo = form.codigo.trim().toLowerCase()
  }

  return payload
}

function RuleBadge({ children, active }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs ${
        active
          ? 'bg-orange-100 text-orange-800'
          : 'bg-gray-100 text-gray-500'
      }`}
    >
      {children}
    </span>
  )
}

export default function CarteraTipificaciones() {
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  const activeCount = useMemo(
    () => rows.filter(item => item.activa).length,
    [rows]
  )

  const loadCatalog = useCallback(async signal => {
    setLoading(true)
    setError('')

    try {
      const response = await apiFetch(
        '/crm-api/cartera/tipificaciones/administracion',
        { signal }
      )
      const data = await readJson(
        response,
        'No fue posible consultar el catálogo'
      )

      if (!Array.isArray(data.data)) {
        throw new Error(
          'La respuesta del catálogo no tiene el formato esperado'
        )
      }

      setRows(data.data)
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
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    // La consulta remota actualiza el catálogo visible.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCatalog(controller.signal)

    return () => controller.abort()
  }, [loadCatalog, refreshVersion])

  const refresh = useCallback(() => {
    setRefreshVersion(value => value + 1)
  }, [])

  const resetForm = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setError('')
  }

  const updateField = event => {
    const {
      name,
      type,
      checked,
      value
    } = event.target

    setForm(current => {
      const nextValue = type === 'checkbox'
        ? checked
        : value

      if (name === 'requiere_validacion_pago' && checked) {
        return {
          ...current,
          requiere_validacion_pago: true,
          estado_resultante: 'pago_reportado',
          requiere_promesa: false,
          requiere_seguimiento: false,
          cierra_cuenta: false
        }
      }

      return {
        ...current,
        [name]: nextValue
      }
    })
  }

  const edit = item => {
    setEditingId(item.id)
    setForm(formFromTypification(item))
    setError('')
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const save = async event => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')

    try {
      const editing = editingId !== null
      const response = await apiFetch(
        editing
          ? `/crm-api/cartera/tipificaciones/${editingId}`
          : '/crm-api/cartera/tipificaciones',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(
            toPayload(form, !editing)
          )
        }
      )

      await readJson(
        response,
        'No fue posible guardar la tipificación'
      )

      setMessage(
        editing
          ? 'Tipificación actualizada correctamente.'
          : 'Tipificación creada correctamente.'
      )
      setEditingId(null)
      setForm(EMPTY_FORM)
      refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async item => {
    const action = item.activa ? 'desactivar' : 'activar'

    if (!window.confirm(
      `¿Desea ${action} la tipificación "${item.nombre}"?`
    )) {
      return
    }

    setSaving(true)
    setError('')
    setMessage('')

    try {
      const response = await apiFetch(
        `/crm-api/cartera/tipificaciones/${item.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ...toPayload(formFromTypification(item)),
            activa: !item.activa
          })
        }
      )

      await readJson(
        response,
        `No fue posible ${action} la tipificación`
      )

      setMessage(
        `Tipificación ${item.activa ? 'desactivada' : 'activada'} correctamente.`
      )
      refresh()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-orange-600">
            CONFIGURACIÓN DE CARTERA
          </p>
          <h1 className="mt-1 text-4xl font-bold">
            Tipificaciones
          </h1>
          <p className="mt-2 text-gray-500">
            Define los resultados y reglas disponibles para cada gestión.
          </p>
        </div>

        <div className="flex gap-3">
          <div className="rounded-2xl border border-orange-200 bg-orange-50 px-5 py-3">
            <p className="text-xs font-bold uppercase text-orange-700">
              Activas
            </p>
            <p className="text-3xl font-normal text-orange-700">
              {activeCount}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white px-5 py-3">
            <p className="text-xs font-bold uppercase text-gray-600">
              Total
            </p>
            <p className="text-3xl font-normal text-gray-700">
              {rows.length}
            </p>
          </div>
        </div>
      </div>

      <form
        onSubmit={save}
        className="mt-8 rounded-3xl bg-white p-6 shadow"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">
              {editingId
                ? 'Editar tipificación'
                : 'Nueva tipificación'}
            </h2>
            <p className="text-sm text-gray-500">
              El código queda fijo después de crear el registro.
            </p>
          </div>

          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
            >
              Cancelar edición
            </button>
          )}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-sm font-normal">
            Código
            <input
              name="codigo"
              value={form.codigo}
              onChange={updateField}
              disabled={editingId !== null}
              required
              maxLength={100}
              pattern="[a-z0-9][a-z0-9_]*"
              placeholder="ejemplo_seguimiento"
              className="mt-2 w-full rounded-xl border p-3 font-normal disabled:bg-gray-100"
            />
          </label>

          <label className="text-sm font-normal xl:col-span-2">
            Nombre
            <input
              name="nombre"
              value={form.nombre}
              onChange={updateField}
              required
              maxLength={150}
              placeholder="Nombre visible para el ejecutivo"
              className="mt-2 w-full rounded-xl border p-3 font-normal"
            />
          </label>

          <label className="text-sm font-normal">
            Prioridad
            <select
              name="prioridad"
              value={form.prioridad}
              onChange={updateField}
              className="mt-2 w-full rounded-xl border bg-white p-3"
            >
              <option value="1">P1 · Alta</option>
              <option value="2">P2 · Media alta</option>
              <option value="3">P3 · Media</option>
              <option value="4">P4 · Informativa</option>
            </select>
          </label>

          <label className="text-sm font-normal">
            Orden
            <input
              name="orden"
              type="number"
              min="1"
              max="999"
              value={form.orden}
              onChange={updateField}
              required
              className="mt-2 w-full rounded-xl border p-3 font-normal"
            />
          </label>

          <label className="text-sm font-normal md:col-span-2">
            Estado resultante
            <select
              name="estado_resultante"
              value={form.estado_resultante}
              onChange={updateField}
              className="mt-2 w-full rounded-xl border bg-white p-3"
            >
              {RESULT_STATES.map(item => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 md:col-span-2 xl:col-span-3 sm:grid-cols-2 xl:grid-cols-3">
            {[
              ['contacto_efectivo', 'Contacto efectivo'],
              ['requiere_promesa', 'Requiere promesa'],
              ['requiere_seguimiento', 'Requiere seguimiento'],
              ['cierra_cuenta', 'Cierra cuenta'],
              ['requiere_validacion_pago', 'Valida pago'],
              ['activa', 'Activa']
            ].map(([name, label]) => (
              <label
                key={name}
                className="flex items-center gap-2 rounded-xl border p-3 text-sm"
              >
                <input
                  name={name}
                  type="checkbox"
                  checked={form[name]}
                  onChange={updateField}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-orange-600 px-5 py-3 text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {saving
              ? 'Guardando…'
              : editingId
                ? 'Guardar cambios'
                : 'Crear tipificación'}
          </button>

          <button
            type="button"
            onClick={refresh}
            disabled={loading || saving}
            className="rounded-xl border px-5 py-3 hover:bg-gray-50 disabled:opacity-50"
          >
            Actualizar catálogo
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
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h2 className="text-xl font-bold">
              Catálogo de la empresa
            </h2>
            <p className="text-sm text-gray-500">
              Desactivar conserva el historial y evita nuevos usos.
            </p>
          </div>

          {loading && (
            <p className="text-sm font-bold text-orange-600">
              Consultando…
            </p>
          )}
        </div>

        {!loading && rows.length === 0 && (
          <div className="p-12 text-center text-gray-500">
            No hay tipificaciones configuradas.
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-[1250px] w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-4">Orden</th>
                  <th className="p-4">Tipificación</th>
                  <th className="p-4">Prioridad</th>
                  <th className="p-4">Estado resultante</th>
                  <th className="p-4">Reglas</th>
                  <th className="p-4">Estatus</th>
                  <th className="p-4">Acciones</th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {rows.map(item => (
                  <tr
                    key={item.id}
                    className={item.activa ? '' : 'bg-gray-50 text-gray-500'}
                  >
                    <td className="p-4">{item.orden}</td>
                    <td className="p-4">
                      <p className="font-normal">{item.nombre}</p>
                      <p className="text-xs text-gray-500">
                        {item.codigo}
                      </p>
                    </td>
                    <td className="p-4">P{item.prioridad}</td>
                    <td className="p-4">
                      {CARTERA_ESTADO_LABEL[item.estado_resultante]
                        || item.estado_resultante}
                    </td>
                    <td className="p-4">
                      <div className="flex max-w-md flex-wrap gap-1.5">
                        <RuleBadge active={item.contacto_efectivo}>
                          Contacto
                        </RuleBadge>
                        <RuleBadge active={item.requiere_promesa}>
                          Promesa
                        </RuleBadge>
                        <RuleBadge active={item.requiere_seguimiento}>
                          Seguimiento
                        </RuleBadge>
                        <RuleBadge active={item.cierra_cuenta}>
                          Cierre
                        </RuleBadge>
                        <RuleBadge
                          active={item.requiere_validacion_pago}
                        >
                          Valida pago
                        </RuleBadge>
                      </div>
                    </td>
                    <td className="p-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs ${
                          item.activa
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-200 text-gray-600'
                        }`}
                      >
                        {item.activa ? 'Activa' : 'Inactiva'}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => edit(item)}
                          disabled={saving}
                          className="rounded-lg bg-gray-900 px-3 py-2 text-white hover:bg-orange-600 disabled:opacity-50"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(item)}
                          disabled={saving}
                          className="rounded-lg border px-3 py-2 hover:bg-gray-100 disabled:opacity-50"
                        >
                          {item.activa ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
