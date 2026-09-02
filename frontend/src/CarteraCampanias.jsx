import {
  useCallback,
  useEffect,
  useState
} from 'react'

import { apiFetch } from './api'
import { formatDate } from './cartera.constants'

const DISTRIBUTION_MODES = [
  {
    value: 'round_robin',
    label: 'Round robin',
    description: 'Reparte automáticamente entre Ejecutivos.'
  },
  {
    value: 'manual',
    label: 'Asignación manual',
    description: 'Administración decide el responsable.'
  },
  {
    value: 'abierta',
    label: 'Abierta para todos',
    description: 'Todos pueden buscar y gestionar la cuenta.'
  }
]

async function readJson(response, fallback) {
  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(data.error || fallback)
  }

  return data
}

export default function CarteraCampanias() {
  const [origins, setOrigins] = useState([])
  const [originId, setOriginId] = useState('')
  const [campaigns, setCampaigns] = useState([])
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadCampaigns = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const query = originId
        ? `?origen=${encodeURIComponent(originId)}`
        : ''
      const response = await apiFetch(
        `/crm-api/cartera/campanias${query}`
      )
      const data = await readJson(
        response,
        'No fue posible consultar las campañas'
      )

      setCampaigns(Array.isArray(data) ? data : [])
      setDrafts(Object.fromEntries(
        (Array.isArray(data) ? data : []).map(item => [
          String(item.id),
          {
            nombre: item.nombre,
            activa: item.activa,
            modo_distribucion:
              item.modo_distribucion || 'round_robin'
          }
        ])
      ))
    } catch (requestError) {
      setCampaigns([])
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [originId])

  useEffect(() => {
    apiFetch('/crm-api/cartera/origenes')
      .then(response => readJson(
        response,
        'No fue posible consultar los orígenes'
      ))
      .then(data => {
        setOrigins(Array.isArray(data) ? data : [])
      })
      .catch(requestError => setError(requestError.message))
  }, [])

  useEffect(() => {
    // La consulta remota actualiza el catálogo al cambiar el origen.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCampaigns()
  }, [loadCampaigns])

  const updateDraft = (id, field, value) => {
    setDrafts(current => ({
      ...current,
      [String(id)]: {
        ...current[String(id)],
        [field]: value
      }
    }))
  }

  const save = async item => {
    const draft = drafts[String(item.id)]
    setSavingId(String(item.id))
    setMessage('')
    setError('')

    try {
      const response = await apiFetch(
        `/crm-api/cartera/campanias/${item.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(draft)
        }
      )

      await readJson(
        response,
        'No fue posible actualizar la campaña'
      )
      setMessage(`Campaña ${item.codigo} actualizada.`)
      await loadCampaigns()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <section className="min-w-0">
      <p className="text-sm font-bold text-orange-600">
        CATÁLOGO DE CARTERA
      </p>
      <h1 className="mt-1 text-4xl font-bold">
        Campañas
      </h1>
      <p className="mt-2 text-gray-500">
        Los códigos se detectan al importar. Configure el nombre y cómo
        se distribuyen sus cuentas sin alterar folios ni historial.
      </p>

      <div className="mt-8 rounded-3xl bg-white p-6 shadow">
        <label className="block max-w-md text-sm font-normal">
          Origen
          <select
            value={originId}
            onChange={event => setOriginId(event.target.value)}
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
      </div>

      {message && (
        <p role="status" className="mt-5 rounded-xl bg-green-50 p-4 text-green-700">
          {message}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-red-700">
          {error}
        </p>
      )}

      <div className="mt-6 overflow-hidden rounded-3xl bg-white shadow">
        <div className="border-b p-5">
          <h2 className="text-xl font-bold">Catálogo de la empresa</h2>
          <p className="text-sm text-gray-500">
            Desactivar conserva los casos y todo su historial.
          </p>
        </div>

        {loading && (
          <p className="p-6 text-orange-600">Consultando…</p>
        )}

        {!loading && campaigns.length === 0 && (
          <p className="p-10 text-center text-gray-500">
            Aún no hay campañas detectadas.
          </p>
        )}

        {campaigns.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-[1250px] w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="p-4">Origen</th>
                  <th className="p-4">Código</th>
                  <th className="p-4">Nombre operativo</th>
                  <th className="p-4">Distribución</th>
                  <th className="p-4">Periodo detectado</th>
                  <th className="p-4">Cuentas del corte</th>
                  <th className="p-4">Estado</th>
                  <th className="p-4">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {campaigns.map(item => {
                  const draft = drafts[String(item.id)] || {}

                  return (
                    <tr key={item.id}>
                      <td className="p-4">{item.origen_nombre}</td>
                      <td className="p-4">{item.codigo}</td>
                      <td className="p-4">
                        <input
                          value={draft.nombre || ''}
                          maxLength={150}
                          onChange={event => updateDraft(
                            item.id,
                            'nombre',
                            event.target.value
                          )}
                          className="w-full min-w-64 rounded-lg border p-2"
                        />
                      </td>
                      <td className="p-4">
                        <select
                          value={draft.modo_distribucion || 'round_robin'}
                          onChange={event => updateDraft(
                            item.id,
                            'modo_distribucion',
                            event.target.value
                          )}
                          className="w-full min-w-52 rounded-lg border bg-white p-2"
                        >
                          {DISTRIBUTION_MODES.map(mode => (
                            <option key={mode.value} value={mode.value}>
                              {mode.label}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 max-w-60 text-xs text-gray-500">
                          {DISTRIBUTION_MODES.find(mode => (
                            mode.value === draft.modo_distribucion
                          ))?.description}
                        </p>
                      </td>
                      <td className="p-4">
                        {formatDate(item.primera_fecha_cartera)}
                        {' — '}
                        {formatDate(item.ultima_fecha_cartera)}
                      </td>
                      <td className="p-4">
                        {item.cuentas_corte_actual}
                      </td>
                      <td className="p-4">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={draft.activa === true}
                            onChange={event => updateDraft(
                              item.id,
                              'activa',
                              event.target.checked
                            )}
                          />
                          {draft.activa ? 'Activa' : 'Inactiva'}
                        </label>
                      </td>
                      <td className="p-4">
                        <button
                          type="button"
                          disabled={savingId === String(item.id)}
                          onClick={() => save(item)}
                          className="rounded-lg bg-gray-900 px-4 py-2 text-white disabled:bg-gray-300"
                        >
                          {savingId === String(item.id)
                            ? 'Guardando…'
                            : 'Guardar'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
