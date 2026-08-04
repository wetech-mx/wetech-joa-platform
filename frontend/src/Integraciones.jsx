import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'

import { apiFetch } from './api'

const ORIGIN_TYPES = [
  {
    value: 'cliente_cobranza',
    label: 'Cliente de cobranza'
  },
  {
    value: 'sistema_interno',
    label: 'Sistema interno'
  },
  {
    value: 'otro',
    label: 'Otro origen'
  }
]

const DIRECTIONS = [
  { value: 'entrada', label: 'Entrada al CRM' },
  { value: 'salida', label: 'Salida desde el CRM' },
  { value: 'bidireccional', label: 'Bidireccional' }
]

const EXECUTION_MODES = [
  { value: 'manual', label: 'Manual' },
  { value: 'programada', label: 'Programada' },
  { value: 'evento', label: 'Por evento' }
]

const DEFAULT_ADAPTERS = {
  api_rest: 'api_rest_generica',
  api_soap: 'api_soap_generica',
  webhook: 'webhook_generico',
  sftp: 'sftp',
  archivo_excel: 'archivo_excel',
  archivo_csv: 'archivo_csv',
  carpeta_compartida: 'carpeta_compartida',
  firebird: 'firebird_solo_lectura',
  sql_server: 'sql_server_solo_lectura',
  odbc: 'odbc_solo_lectura',
  aspel_dac: 'aspel_dac'
}

const EMPTY_ORIGIN = {
  codigo: '',
  nombre: '',
  tipo: 'cliente_cobranza',
  descripcion: '',
  activo: true
}

const EMPTY_INTEGRATION = {
  origen_id: '',
  tipo_codigo: 'api_rest',
  codigo: '',
  nombre: '',
  producto: '',
  adaptador: 'api_rest_generica',
  direccion: 'entrada',
  modo_ejecucion: 'manual',
  activo: false
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

function originTypeLabel(value) {
  return ORIGIN_TYPES.find(
    item => item.value === value
  )?.label || value
}

function StatusBadge({ active }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
        active
          ? 'bg-green-100 text-green-700'
          : 'bg-gray-200 text-gray-600'
      }`}
    >
      {active ? 'Activo' : 'Inactivo'}
    </span>
  )
}

function SecretBadge({ configured }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
        configured
          ? 'bg-blue-100 text-blue-700'
          : 'bg-amber-100 text-amber-800'
      }`}
    >
      {configured
        ? 'Configurado en servidor'
        : 'Sin secreto configurado'}
    </span>
  )
}

function Metric({ label, value, tone }) {
  const tones = {
    orange: 'border-orange-500 bg-orange-50 text-orange-700',
    blue: 'border-blue-500 bg-blue-50 text-blue-700',
    green: 'border-green-500 bg-green-50 text-green-700',
    gray: 'border-gray-500 bg-gray-50 text-gray-700'
  }

  return (
    <article
      className={`rounded-2xl border-l-4 p-5 shadow-sm ${tones[tone] || tones.gray}`}
    >
      <p className="text-xs font-bold uppercase tracking-wide">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold">
        {value}
      </p>
    </article>
  )
}

function Modal({ title, children, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-7 shadow-2xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-orange-600">
              Administración protegida
            </p>
            <h2 className="mt-1 text-2xl font-bold">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-gray-100 px-4 py-2 font-bold text-gray-600 hover:bg-gray-200"
          >
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-bold text-gray-800">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-xs text-gray-500">
          {hint}
        </span>
      )}
    </label>
  )
}

export default function Integraciones() {
  const [types, setTypes] = useState([])
  const [origins, setOrigins] = useState([])
  const [integrations, setIntegrations] = useState([])
  const [selectedOriginId, setSelectedOriginId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [originModal, setOriginModal] = useState(false)
  const [integrationModal, setIntegrationModal] = useState(false)
  const [editingOriginId, setEditingOriginId] = useState(null)
  const [editingIntegrationId, setEditingIntegrationId] = useState(null)
  const [originForm, setOriginForm] = useState(EMPTY_ORIGIN)
  const [integrationForm, setIntegrationForm] = useState(
    EMPTY_INTEGRATION
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const responses = await Promise.all([
        apiFetch('/crm-api/integraciones/tipos'),
        apiFetch('/crm-api/integraciones/origenes'),
        apiFetch('/crm-api/integraciones')
      ])

      const [typeData, originData, integrationData] =
        await Promise.all([
          readJson(
            responses[0],
            'No fue posible consultar los tipos de integración'
          ),
          readJson(
            responses[1],
            'No fue posible consultar los orígenes'
          ),
          readJson(
            responses[2],
            'No fue posible consultar las integraciones'
          )
        ])

      if (
        !Array.isArray(typeData)
        || !Array.isArray(originData)
        || !Array.isArray(integrationData)
      ) {
        throw new Error(
          'La API de integraciones devolvió un formato inesperado'
        )
      }

      setTypes(typeData)
      setOrigins(originData)
      setIntegrations(integrationData)
    } catch (requestError) {
      setTypes([])
      setOrigins([])
      setIntegrations([])
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // La carga remota actualiza los catálogos de esta pantalla.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
  }, [loadData])

  const visibleIntegrations = useMemo(() => {
    if (!selectedOriginId) {
      return integrations
    }

    return integrations.filter(
      item => String(item.origen_id) === selectedOriginId
    )
  }, [integrations, selectedOriginId])

  const activeOrigins = origins.filter(item => item.activo).length
  const activeIntegrations = integrations.filter(
    item => item.activo
  ).length
  const configuredSecrets = integrations.filter(
    item => item.secreto_configurado
  ).length

  const openNewOrigin = () => {
    setEditingOriginId(null)
    setOriginForm(EMPTY_ORIGIN)
    setOriginModal(true)
    setError('')
    setNotice('')
  }

  const openEditOrigin = origin => {
    setEditingOriginId(String(origin.id))
    setOriginForm({
      codigo: origin.codigo || '',
      nombre: origin.nombre || '',
      tipo: origin.tipo || 'otro',
      descripcion: origin.descripcion || '',
      activo: Boolean(origin.activo)
    })
    setOriginModal(true)
    setError('')
    setNotice('')
  }

  const openNewIntegration = originId => {
    const targetOriginId = String(
      originId || selectedOriginId || origins[0]?.id || ''
    )

    if (!targetOriginId) {
      setError(
        'Primero debes registrar un origen antes de crear una integración'
      )
      return
    }

    setEditingIntegrationId(null)
    setIntegrationForm({
      ...EMPTY_INTEGRATION,
      origen_id: targetOriginId
    })
    setIntegrationModal(true)
    setError('')
    setNotice('')
  }

  const openEditIntegration = integration => {
    setEditingIntegrationId(String(integration.id))
    setIntegrationForm({
      origen_id: String(integration.origen_id || ''),
      tipo_codigo: integration.tipo_codigo || 'api_rest',
      codigo: integration.codigo || '',
      nombre: integration.nombre || '',
      producto: integration.producto || '',
      adaptador: integration.adaptador || '',
      direccion: integration.direccion || 'entrada',
      modo_ejecucion: integration.modo_ejecucion || 'manual',
      activo: Boolean(integration.activo)
    })
    setIntegrationModal(true)
    setError('')
    setNotice('')
  }

  const saveOrigin = async event => {
    event.preventDefault()
    setSaving(true)
    setError('')

    try {
      const endpoint = editingOriginId
        ? `/crm-api/integraciones/origenes/${editingOriginId}`
        : '/crm-api/integraciones/origenes'
      const method = editingOriginId ? 'PATCH' : 'POST'
      const response = await apiFetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(originForm)
      })

      await readJson(
        response,
        'No fue posible guardar el origen'
      )

      setOriginModal(false)
      setNotice(
        editingOriginId
          ? 'Origen actualizado correctamente.'
          : 'Origen registrado correctamente.'
      )
      await loadData()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  const saveIntegration = async event => {
    event.preventDefault()
    setSaving(true)
    setError('')

    try {
      const endpoint = editingIntegrationId
        ? `/crm-api/integraciones/${editingIntegrationId}`
        : `/crm-api/integraciones/origenes/${integrationForm.origen_id}/integraciones`
      const method = editingIntegrationId ? 'PATCH' : 'POST'
      const payload = {
        tipo_codigo: integrationForm.tipo_codigo,
        codigo: integrationForm.codigo,
        nombre: integrationForm.nombre,
        producto: integrationForm.producto,
        adaptador: integrationForm.adaptador,
        direccion: integrationForm.direccion,
        modo_ejecucion: integrationForm.modo_ejecucion,
        activo: integrationForm.activo
      }

      if (editingIntegrationId) {
        payload.origen_id = integrationForm.origen_id
      }

      const response = await apiFetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      await readJson(
        response,
        'No fue posible guardar la integración'
      )

      setIntegrationModal(false)
      setNotice(
        editingIntegrationId
          ? 'Integración actualizada correctamente.'
          : 'Integración registrada como pendiente de configuración.'
      )
      await loadData()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  const changeIntegrationType = typeCode => {
    setIntegrationForm(current => ({
      ...current,
      tipo_codigo: typeCode,
      adaptador: DEFAULT_ADAPTERS[typeCode] || typeCode
    }))
  }

  return (
    <section>
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-orange-600">
            Administración multi-origen
          </p>
          <h1 className="mt-1 text-4xl font-bold">
            Integraciones
          </h1>
          <p className="mt-2 max-w-3xl text-gray-500">
            Registra clientes, sistemas y métodos de intercambio sin convertirlos en empresas independientes.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={openNewOrigin}
            className="rounded-xl bg-orange-600 px-5 py-3 font-bold text-white shadow-sm hover:bg-orange-700"
          >
            + Nuevo origen
          </button>
          <button
            type="button"
            onClick={() => openNewIntegration()}
            disabled={origins.length === 0}
            className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Nueva integración
          </button>
        </div>
      </div>

      <div className="mb-7 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-bold">
          Las credenciales nunca se capturan en esta pantalla.
        </p>
        <p className="mt-1">
          Contraseñas, certificados, tokens y llaves se configuran únicamente en el servidor. Aquí solo se administra el catálogo operativo.
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-red-300 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      {notice && (
        <div className="mb-6 rounded-2xl border border-green-300 bg-green-50 p-4 text-green-700">
          {notice}
        </div>
      )}

      <div className="mb-8 grid gap-4 md:grid-cols-4">
        <Metric
          label="Orígenes"
          value={origins.length}
          tone="orange"
        />
        <Metric
          label="Orígenes activos"
          value={activeOrigins}
          tone="green"
        />
        <Metric
          label="Integraciones activas"
          value={activeIntegrations}
          tone="blue"
        />
        <Metric
          label="Secretos en servidor"
          value={configuredSecrets}
          tone="gray"
        />
      </div>

      <div className="mb-8 overflow-hidden rounded-3xl bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b p-6">
          <div>
            <h2 className="text-2xl font-bold">
              Orígenes de información
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Clientes o sistemas que entregan cartera y otros datos.
            </p>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="rounded-xl border border-gray-300 px-4 py-2 font-bold text-gray-700 hover:bg-gray-50"
          >
            Actualizar
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-6 py-4">Origen</th>
                <th className="px-6 py-4">Código</th>
                <th className="px-6 py-4">Tipo</th>
                <th className="px-6 py-4">Conectores</th>
                <th className="px-6 py-4">Estado</th>
                <th className="px-6 py-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {!loading && origins.length === 0 && (
                <tr>
                  <td
                    colSpan="6"
                    className="px-6 py-12 text-center text-gray-500"
                  >
                    No hay orígenes registrados.
                  </td>
                </tr>
              )}
              {origins.map(origin => (
                <tr key={origin.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <p className="font-bold text-gray-900">
                      {origin.nombre}
                    </p>
                    <p className="mt-1 max-w-md text-xs text-gray-500">
                      {origin.descripcion || 'Sin descripción'}
                    </p>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-gray-600">
                    {origin.codigo}
                  </td>
                  <td className="px-6 py-4">
                    {originTypeLabel(origin.tipo)}
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-bold">
                      {Number(origin.integraciones) || 0}
                    </span>
                    <span className="ml-1 text-xs text-gray-500">
                      ({Number(origin.integraciones_activas) || 0} activos)
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge active={origin.activo} />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedOriginId(String(origin.id))
                          document
                            .getElementById('lista-integraciones')
                            ?.scrollIntoView({ behavior: 'smooth' })
                        }}
                        className="rounded-lg bg-blue-50 px-3 py-2 font-bold text-blue-700 hover:bg-blue-100"
                      >
                        Ver conectores
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditOrigin(origin)}
                        className="rounded-lg bg-gray-100 px-3 py-2 font-bold text-gray-700 hover:bg-gray-200"
                      >
                        Editar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div
        id="lista-integraciones"
        className="overflow-hidden rounded-3xl bg-white shadow-sm"
      >
        <div className="flex flex-wrap items-end justify-between gap-4 border-b p-6">
          <div>
            <h2 className="text-2xl font-bold">
              Conectores
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              API, SFTP, archivos, bases de datos y herramientas Aspel.
            </p>
          </div>
          <Field label="Filtrar por origen">
            <select
              value={selectedOriginId}
              onChange={event => setSelectedOriginId(event.target.value)}
              className="min-w-64 rounded-xl border border-gray-300 bg-white px-4 py-3"
            >
              <option value="">Todos los orígenes</option>
              {origins.map(origin => (
                <option key={origin.id} value={origin.id}>
                  {origin.nombre}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-6 py-4">Integración</th>
                <th className="px-6 py-4">Origen</th>
                <th className="px-6 py-4">Método</th>
                <th className="px-6 py-4">Flujo</th>
                <th className="px-6 py-4">Ejecución</th>
                <th className="px-6 py-4">Servidor</th>
                <th className="px-6 py-4">Estado</th>
                <th className="px-6 py-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {!loading && visibleIntegrations.length === 0 && (
                <tr>
                  <td
                    colSpan="8"
                    className="px-6 py-12 text-center text-gray-500"
                  >
                    No hay integraciones para mostrar.
                  </td>
                </tr>
              )}
              {visibleIntegrations.map(integration => (
                <tr
                  key={integration.id}
                  className="hover:bg-gray-50"
                >
                  <td className="px-6 py-4">
                    <p className="font-bold text-gray-900">
                      {integration.nombre}
                    </p>
                    <p className="mt-1 font-mono text-xs text-gray-500">
                      {integration.codigo}
                    </p>
                    {integration.producto && (
                      <p className="mt-1 text-xs text-gray-500">
                        {integration.producto}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {integration.origen_nombre}
                  </td>
                  <td className="px-6 py-4">
                    <p className="font-semibold">
                      {integration.tipo_nombre}
                    </p>
                    <p className="text-xs text-gray-500">
                      {integration.categoria}
                    </p>
                  </td>
                  <td className="px-6 py-4 capitalize">
                    {integration.direccion}
                  </td>
                  <td className="px-6 py-4 capitalize">
                    {integration.modo_ejecucion}
                  </td>
                  <td className="px-6 py-4">
                    <SecretBadge
                      configured={integration.secreto_configurado}
                    />
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge active={integration.activo} />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="button"
                      onClick={() => openEditIntegration(integration)}
                      className="rounded-lg bg-gray-100 px-3 py-2 font-bold text-gray-700 hover:bg-gray-200"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {originModal && (
        <Modal
          title={editingOriginId ? 'Editar origen' : 'Nuevo origen'}
          onClose={() => setOriginModal(false)}
        >
          <form onSubmit={saveOrigin} className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Nombre">
                <input
                  required
                  maxLength="255"
                  value={originForm.nombre}
                  onChange={event => setOriginForm(current => ({
                    ...current,
                    nombre: event.target.value
                  }))}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3"
                  placeholder="Ej. Banco Azteca"
                />
              </Field>
              <Field
                label="Código interno"
                hint="Solo minúsculas, números y guion bajo."
              >
                <input
                  required
                  pattern="[a-z0-9]+(_[a-z0-9]+)*"
                  maxLength="100"
                  value={originForm.codigo}
                  onChange={event => setOriginForm(current => ({
                    ...current,
                    codigo: event.target.value
                  }))}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 font-mono"
                  placeholder="cliente_nuevo"
                />
              </Field>
            </div>

            <Field label="Clasificación">
              <select
                value={originForm.tipo}
                onChange={event => setOriginForm(current => ({
                  ...current,
                  tipo: event.target.value
                }))}
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3"
              >
                {ORIGIN_TYPES.map(item => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Descripción">
              <textarea
                rows="4"
                maxLength="2000"
                value={originForm.descripcion}
                onChange={event => setOriginForm(current => ({
                  ...current,
                  descripcion: event.target.value
                }))}
                className="w-full rounded-xl border border-gray-300 px-4 py-3"
                placeholder="Describe qué información entrega este origen."
              />
            </Field>

            <label className="flex items-center gap-3 rounded-xl bg-gray-50 p-4">
              <input
                type="checkbox"
                checked={originForm.activo}
                onChange={event => setOriginForm(current => ({
                  ...current,
                  activo: event.target.checked
                }))}
                className="h-5 w-5"
              />
              <span>
                <strong className="block">Origen activo</strong>
                <span className="text-sm text-gray-500">
                  Los orígenes inactivos se conservan para auditoría.
                </span>
              </span>
            </label>

            <div className="flex justify-end gap-3 border-t pt-5">
              <button
                type="button"
                onClick={() => setOriginModal(false)}
                className="rounded-xl bg-gray-100 px-5 py-3 font-bold text-gray-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-orange-600 px-5 py-3 font-bold text-white disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Guardar origen'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {integrationModal && (
        <Modal
          title={
            editingIntegrationId
              ? 'Editar integración'
              : 'Nueva integración'
          }
          onClose={() => setIntegrationModal(false)}
        >
          <form onSubmit={saveIntegration} className="space-y-5">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Este formulario no admite credenciales. Si el conector necesita autenticación, se configurará después directamente en el servidor.
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Origen">
                <select
                  required
                  value={integrationForm.origen_id}
                  onChange={event => setIntegrationForm(current => ({
                    ...current,
                    origen_id: event.target.value
                  }))}
                  className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3"
                >
                  <option value="">Selecciona un origen</option>
                  {origins.map(origin => (
                    <option key={origin.id} value={origin.id}>
                      {origin.nombre}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Método de integración">
                <select
                  required
                  value={integrationForm.tipo_codigo}
                  onChange={event => changeIntegrationType(
                    event.target.value
                  )}
                  className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3"
                >
                  {types.map(type => (
                    <option key={type.codigo} value={type.codigo}>
                      {type.nombre}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Nombre">
                <input
                  required
                  maxLength="255"
                  value={integrationForm.nombre}
                  onChange={event => setIntegrationForm(current => ({
                    ...current,
                    nombre: event.target.value
                  }))}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3"
                  placeholder="Ej. API de cartera"
                />
              </Field>
              <Field
                label="Código interno"
                hint="Solo minúsculas, números y guion bajo."
              >
                <input
                  required
                  pattern="[a-z0-9]+(_[a-z0-9]+)*"
                  maxLength="100"
                  value={integrationForm.codigo}
                  onChange={event => setIntegrationForm(current => ({
                    ...current,
                    codigo: event.target.value
                  }))}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 font-mono"
                  placeholder="api_cliente_nuevo"
                />
              </Field>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <Field
                label="Producto o sistema"
                hint="Ej. Aspel SAE, sistema propio o portal bancario."
              >
                <input
                  maxLength="100"
                  value={integrationForm.producto}
                  onChange={event => setIntegrationForm(current => ({
                    ...current,
                    producto: event.target.value
                  }))}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3"
                  placeholder="Aspel SAE"
                />
              </Field>
              <Field
                label="Adaptador técnico"
                hint="Identifica el programa conector; no contiene credenciales."
              >
                <input
                  required
                  maxLength="100"
                  value={integrationForm.adaptador}
                  onChange={event => setIntegrationForm(current => ({
                    ...current,
                    adaptador: event.target.value
                  }))}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 font-mono"
                />
              </Field>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Dirección de datos">
                <select
                  value={integrationForm.direccion}
                  onChange={event => setIntegrationForm(current => ({
                    ...current,
                    direccion: event.target.value
                  }))}
                  className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3"
                >
                  {DIRECTIONS.map(item => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Modo de ejecución">
                <select
                  value={integrationForm.modo_ejecucion}
                  onChange={event => setIntegrationForm(current => ({
                    ...current,
                    modo_ejecucion: event.target.value
                  }))}
                  className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3"
                >
                  {EXECUTION_MODES.map(item => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <label className="flex items-center gap-3 rounded-xl bg-gray-50 p-4">
              <input
                type="checkbox"
                checked={integrationForm.activo}
                onChange={event => setIntegrationForm(current => ({
                  ...current,
                  activo: event.target.checked
                }))}
                className="h-5 w-5"
              />
              <span>
                <strong className="block">Integración activa</strong>
                <span className="text-sm text-gray-500">
                  Los conectores nuevos permanecen inactivos hasta completar su configuración técnica.
                </span>
              </span>
            </label>

            <div className="flex justify-end gap-3 border-t pt-5">
              <button
                type="button"
                onClick={() => setIntegrationModal(false)}
                className="rounded-xl bg-gray-100 px-5 py-3 font-bold text-gray-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Guardar integración'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
