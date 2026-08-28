import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'

import { apiFetch } from './api'

import {
  CARTERA_ESTADO_LABEL,
  GESTION_CANALES,
  GESTION_RELACIONES,
  formatDate,
  formatDateTime,
  formatMoney
} from './cartera.constants'

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

function DetailItem({
  label,
  value
}) {
  return (
    <div className="rounded-xl bg-gray-50 p-3">
      <p className="text-xs font-bold uppercase text-gray-500">
        {label}
      </p>
      <div className="mt-1 break-words font-normal">
        {value ?? '—'}
      </div>
    </div>
  )
}

const DRAWER_TABS = [
  { id: 'summary', label: 'Resumen' },
  { id: 'details', label: 'Detalles' },
  { id: 'management', label: 'Gestiones' },
  { id: 'audit', label: 'Auditoría' }
]

function SummaryMetric({
  label,
  value,
  tone = 'slate'
}) {
  const toneClass = {
    slate: 'border-slate-200 bg-slate-50 text-slate-900',
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    orange: 'border-orange-200 bg-orange-50 text-orange-900',
    red: 'border-red-200 bg-red-50 text-red-900'
  }[tone]

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-xs font-bold uppercase tracking-wide opacity-70">
        {label}
      </p>
      <p className="mt-2 break-words text-xl font-normal">
        {value ?? '—'}
      </p>
    </div>
  )
}

function DrawerTab({
  active,
  children,
  onClick
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'min-w-max border-b-2 px-4 py-3 text-sm font-bold transition',
        active
          ? 'border-orange-600 text-orange-700'
          : 'border-transparent text-gray-500 hover:text-gray-900'
      ].join(' ')}
    >
      {children}
    </button>
  )
}

const SOURCE_DETAIL_SECTIONS = [
  {
    title: 'Cliente',
    fields: [
      'CLIENTE_UNICO', 'NOMBRE_CTE', 'GENERO_CLIENTE',
      'EDAD_CLIENTE', 'OCUPACION', 'CLASIFICACION_CTE'
    ]
  },
  {
    title: 'Domicilio',
    fields: [
      'DIRECCION_CTE', 'NUM_EXT_CTE', 'NUM_INT_CTE',
      'CP_CTE', 'COLONIA_CTE', 'POBLACION_CTE',
      'ESTADO_CTE', 'REFERENCIAS_DOMICILIO',
      'LATITUD', 'LONGITUD'
    ]
  },
  {
    title: 'Asignación y segmentación',
    fields: [
      'TERRITORIO', 'TERRITORIAL', 'ZONA', 'ZONAL',
      'NOMBRE_DESPACHO', 'GERENCIA', 'FECHA_ASIGNACION',
      'DIAS_ASIGNACION', 'DIQUE', 'ATRASO_MAXIMO',
      'DIAS_ATRASO', 'SEMANAS_ATRASO', 'ATRASO',
      'PRODUCTO', 'ESTRATEGIA', 'SEGMENTO_GENERACION'
    ]
  },
  {
    title: 'Saldos y pagos',
    fields: [
      'SALDO', 'MORATORIOS', 'SALDO_TOTAL',
      'SALDO ATRASADO', 'SALDO REQUERIDO', 'PAGO_NORMAL',
      'FECHA_ULTIMO_PAGO', 'IMP_ULTIMO_PAGO', 'FIDIAPAGO',
      'PAGOS_CLIENTE', 'MONTO_PAGOS', 'ABONO_SEMANAL',
      'MONTO_ABONADO', 'PAGOS_RECIBIDOS'
    ]
  },
  {
    title: 'Empleo y aval',
    fields: [
      'CALLE_EMPLEO', 'NUM_EXT_EMPLEO', 'NUM_INT_EMPLEO',
      'COLONIA_EMPLEO', 'POBLACION_EMPLEO', 'ESTADO_EMPLEO',
      'EMPLEADO', 'NOMBRE_AVAL', 'TEL_AVAL', 'CALLE_AVAL',
      'NUM_EXT_AVAL', 'COLONIA_AVAL', 'CP_AVAL',
      'POBLACION_AVAL', 'ESTADO_AVAL'
    ]
  },
  {
    title: 'Teléfonos',
    fields: [
      'TELEFONO1', 'TIPOTEL1', 'TELEFONO2', 'TIPOTEL2',
      'TELEFONO3', 'TIPOTEL3', 'TELEFONO4', 'TIPOTEL4'
    ]
  },
  {
    title: 'Gestión y campaña',
    fields: [
      'DESPACHO_GESTIONO', 'ULTIMA_GESTION', 'GESTION_DESC',
      'CAMPANIA_RELAMPAGO', 'CAMPANIA', 'PREVENTA',
      'ID_GRUPO', 'GRUPO_MAZ', 'CLAVE_SPEI', 'GESTORES',
      'ULTIMO_ESTATUS', 'CANAL', 'TIPO_QUEJA'
    ]
  },
  {
    title: 'Plan y promesa de pago',
    fields: [
      'FOLIO_PLAN', 'ESTATUS_PLAN', 'GENERACION_PLAN',
      'CANCELACION_CUMPLIMIENTO_PLAN', 'PLAZO', 'MONTO_PLAN',
      'ENGANCHE', 'SALDO_ANTES_DEL_PLAN',
      'SALDO_ATRASADO_ANTES_PLAN', 'MORATORIOS_ANTES_PLAN',
      'ESTATUS_PROMESA_PAGO', 'MONTO_PROMESA_PAGO'
    ]
  }
]

function sourceLabel(field) {
  return field
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/(^|\s)\S/g, letter => letter.toUpperCase())
}

function hasSourceValue(value) {
  return !(
    value === null
    || value === undefined
    || String(value).trim() === ''
  )
}

function SourceDataSection({
  section,
  data
}) {
  const fields = section.fields.filter(
    field => Object.hasOwn(data, field)
  )

  if (fields.length === 0) {
    return null
  }

  const available = fields.filter(
    field => hasSourceValue(data[field])
  ).length

  return (
    <details className="rounded-xl border bg-white">
      <summary className="cursor-pointer px-4 py-3 font-bold">
        {section.title}
        <span className="ml-2 text-xs font-normal text-gray-500">
          {available} datos disponibles
        </span>
      </summary>
      <div className="grid gap-3 border-t p-4 sm:grid-cols-2">
        {fields.map(field => (
          <DetailItem
            key={field}
            label={sourceLabel(field)}
            value={hasSourceValue(data[field])
              ? data[field]
              : '—'}
          />
        ))}
      </div>
    </details>
  )
}

function emptyManagement(phone = '') {
  return {
    tipificacion_id: '',
    codigo_resultado: '',
    canal: 'telefono',
    telefono_contactado: phone,
    persona_contactada: '',
    relacion_contacto: 'titular',
    promesa_monto: '',
    promesa_fecha: '',
    proximo_seguimiento_at: '',
    notas: '',
    evidencia: ''
  }
}

export default function CarteraDrawer({
  accountId,
  usuario,
  executives,
  onClose,
  onChanged
}) {
  const [detail, setDetail] = useState(null)
  const [typifications, setTypifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [management, setManagement] = useState(
    emptyManagement()
  )
  const [executiveId, setExecutiveId] = useState('')
  const [reason, setReason] = useState('')
  const [activeTab, setActiveTab] = useState('summary')

  const isAdministrator = usuario?.rol !== 'Ejecutivo'

  const loadDetail = useCallback(async signal => {
    setLoading(true)
    setError('')

    try {
      const [detailResponse, typificationsResponse] =
        await Promise.all([
          apiFetch(
            `/crm-api/cartera/${accountId}`,
            { signal }
          ),
          apiFetch(
            '/crm-api/cartera/tipificaciones',
            { signal }
          )
        ])
      const [detailData, typificationsData] =
        await Promise.all([
          readJson(
            detailResponse,
            'No fue posible consultar la cuenta'
          ),
          readJson(
            typificationsResponse,
            'No fue posible consultar las tipificaciones'
          )
        ])

      setDetail(detailData)
      setTypifications(typificationsData.data || [])
      setExecutiveId(
        String(detailData.account?.ejecutivo_id || '')
      )
      setManagement(current => ({
        ...current,
        telefono_contactado:
          current.telefono_contactado
          || detailData.account?.telefono_1
          || ''
      }))
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        setError(requestError.message)
      }
    } finally {
      if (!signal.aborted) {
        setLoading(false)
      }
    }
  }, [accountId])

  useEffect(() => {
    const controller = new AbortController()

    // La carga remota actualiza el estado con la respuesta de la API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDetail(controller.signal)

    return () => controller.abort()
  }, [loadDetail])

  const selectedTypification = useMemo(
    () => typifications.find(
      item => String(item.id)
        === String(management.tipificacion_id)
    ) || null,
    [management.tipificacion_id, typifications]
  )

  const reloadAfterChange = async () => {
    const controller = new AbortController()
    await loadDetail(controller.signal)
    onChanged()
  }

  const updateManagement = (field, value) => {
    setManagement(current => ({
      ...current,
      [field]: value
    }))
  }

  const selectTypification = value => {
    const selected = typifications.find(
      item => String(item.id) === String(value)
    )

    setManagement(current => ({
      ...current,
      tipificacion_id: value,
      promesa_monto: selected?.requiere_promesa
        ? current.promesa_monto
        : '',
      promesa_fecha: selected?.requiere_promesa
        ? current.promesa_fecha
        : ''
    }))
  }

  const registerManagement = async event => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')

    try {
      const response = await apiFetch(
        `/crm-api/cartera/${accountId}/gestiones`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ...management,
            codigo_resultado:
              management.codigo_resultado || null,
            telefono_contactado:
              management.telefono_contactado || null,
            persona_contactada:
              management.persona_contactada || null,
            promesa_monto:
              selectedTypification?.requiere_promesa
                ? management.promesa_monto
                : null,
            promesa_fecha:
              selectedTypification?.requiere_promesa
                ? management.promesa_fecha
                : null,
            proximo_seguimiento_at:
              management.proximo_seguimiento_at
                ? new Date(
                  management.proximo_seguimiento_at
                ).toISOString()
                : null,
            evidencia: management.evidencia || null
          })
        }
      )

      await readJson(
        response,
        'No fue posible registrar la gestión'
      )

      const currentPhone =
        detail?.account?.telefono_1 || ''
      setManagement(emptyManagement(currentPhone))
      setMessage('Gestión registrada correctamente.')
      await reloadAfterChange()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  const reassign = async event => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')

    try {
      const response = await apiFetch(
        `/crm-api/cartera/${accountId}/reasignar`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            ejecutivo_id: Number(executiveId),
            motivo: reason
          })
        }
      )

      await readJson(
        response,
        'No fue posible reasignar la cuenta'
      )

      setReason('')
      setMessage('Cuenta reasignada correctamente.')
      await reloadAfterChange()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  const account = detail?.account
  const history = detail?.history || []
  const latestManagement = history.find(
    item => item.gestion_id
  ) || null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="h-full w-full max-w-6xl overflow-y-auto bg-white shadow-2xl">
        <header className="sticky top-0 z-20 border-b bg-white/95 backdrop-blur">
          <div className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
            <div className="min-w-0">
            <p className="text-xs font-bold text-orange-600">
              EXPEDIENTE DE CUENTA
            </p>
            <h2 className="mt-1 truncate text-2xl font-bold">
              {account?.nombre || 'Cargando cuenta…'}
            </h2>
              {account && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full bg-blue-50 px-3 py-1 font-bold text-blue-800 ring-1 ring-blue-200">
                    Ejecutivo: {account.ejecutivo_nombre || 'Sin asignar'}
                  </span>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-700">
                    {CARTERA_ESTADO_LABEL[account.estado_gestion]
                      || account.estado_gestion}
                  </span>
                  <span className="text-gray-500">
                    {account.id_campania || 'Sin campaña'} · {account.folio || 'Sin folio'}
                  </span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar detalle"
              className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 font-normal text-white"
            >
              Cerrar
            </button>
          </div>

          {account && (
            <nav
              role="tablist"
              aria-label="Secciones del expediente"
              className="flex overflow-x-auto border-t px-2 sm:px-4"
            >
              {DRAWER_TABS.map(tab => (
                <DrawerTab
                  key={tab.id}
                  active={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                  {tab.id === 'audit' ? ` (${history.length})` : ''}
                </DrawerTab>
              ))}
            </nav>
          )}
        </header>

        <div className="space-y-6 p-6">
          {loading && (
            <p className="font-normal text-orange-600">
              Consultando información…
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-700"
            >
              {error}
            </div>
          )}

          {message && (
            <div
              role="status"
              className="rounded-xl border border-green-300 bg-green-50 p-4 text-green-700"
            >
              {message}
            </div>
          )}

          {account && (
            <>
              {activeTab === 'summary' && (
                <section
                  role="tabpanel"
                  aria-label="Resumen de la cuenta"
                  className="space-y-5"
                >
                  {account.pago_validacion_estado === 'pendiente' && (
                    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
                      <p className="font-bold">
                        Pago reportado pendiente de validación
                      </p>
                      <p className="mt-1 text-sm">
                        La cuenta permanece asignada y no admite otra gestión
                        hasta que un administrador resuelva el reporte.
                      </p>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-orange-600">
                      Vista rápida
                    </p>
                    <h3 className="mt-1 text-2xl font-bold">
                      Información clave para gestionar
                    </h3>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <SummaryMetric
                      label="Saldo total"
                      value={formatMoney(account.saldo)}
                      tone="blue"
                    />
                    <SummaryMetric
                      label="Pago requerido"
                      value={formatMoney(account.pago_requerido)}
                      tone="orange"
                    />
                    <SummaryMetric
                      label="Atraso"
                      value={`${account.dias_atraso ?? '—'} días · ${account.semanas_atraso ?? '—'} semanas`}
                      tone="red"
                    />
                    <SummaryMetric
                      label="Fecha de cartera"
                      value={formatDate(account.ultima_fecha_cartera)}
                    />
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <article className="rounded-2xl border p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                            Ejecutivo responsable
                          </p>
                          <p className="mt-2 text-xl font-bold text-blue-900">
                            {account.ejecutivo_nombre || 'Sin asignar'}
                          </p>
                        </div>
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-bold text-blue-800 ring-1 ring-blue-200">
                          Asignación activa
                        </span>
                      </div>
                      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-gray-500">Campaña</dt>
                          <dd className="mt-1 break-words font-bold">
                            {account.id_campania || 'Sin campaña'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Folio</dt>
                          <dd className="mt-1 break-words font-bold">
                            {account.folio || '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">ID cliente</dt>
                          <dd className="mt-1 break-words font-bold">
                            {account.id_cliente || '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Estado</dt>
                          <dd className="mt-1 font-bold">
                            {CARTERA_ESTADO_LABEL[account.estado_gestion]
                              || account.estado_gestion}
                          </dd>
                        </div>
                      </dl>
                    </article>

                    <article className="rounded-2xl border p-5">
                      <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                        Contacto inmediato
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {[1, 2, 3, 4].map(index => {
                          const phone = account[`telefono_${index}`]

                          return phone ? (
                            <a
                              key={index}
                              href={`tel:${phone}`}
                              className="rounded-xl bg-green-50 px-3 py-2 font-bold text-green-800 ring-1 ring-green-200 hover:bg-green-100"
                            >
                              Tel. {index}: {phone}
                            </a>
                          ) : null
                        })}
                      </div>
                      <p className="mt-5 text-xs font-bold uppercase tracking-wide text-gray-500">
                        Última gestión registrada
                      </p>
                      {latestManagement ? (
                        <div className="mt-2 rounded-xl bg-gray-50 p-3">
                          <p className="font-bold">
                            {latestManagement.tipificacion_nombre
                              || latestManagement.evento}
                          </p>
                          <p className="mt-1 text-sm text-gray-600">
                            {formatDateTime(latestManagement.creada_at)} ·{' '}
                            {latestManagement.usuario_nombre || 'Sistema'}
                          </p>
                          {latestManagement.persona_contactada && (
                            <p className="mt-1 text-sm text-gray-600">
                              Contacto: {latestManagement.persona_contactada}
                              {latestManagement.relacion_contacto
                                ? ` · ${latestManagement.relacion_contacto}`
                                : ''}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="mt-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-500">
                          Sin gestiones registradas.
                        </p>
                      )}
                    </article>
                  </div>

                  <div className="flex flex-wrap gap-3 border-t pt-5">
                    <button
                      type="button"
                      onClick={() => setActiveTab('management')}
                      className="rounded-xl bg-orange-600 px-5 py-3 font-bold text-white hover:bg-orange-700"
                    >
                      Ir a registrar gestión
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('details')}
                      className="rounded-xl border px-5 py-3 font-bold hover:bg-gray-50"
                    >
                      Consultar expediente completo
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('audit')}
                      className="rounded-xl border px-5 py-3 font-bold hover:bg-gray-50"
                    >
                      Ver auditoría
                    </button>
                  </div>
                </section>
              )}

              <div
                role="tabpanel"
                aria-label="Detalles de la cuenta"
                className={activeTab === 'details'
                  ? 'space-y-6'
                  : 'hidden'}
              >
                <section>
                <h3 className="mb-3 text-lg font-bold">
                  Identidad y asignación
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailItem label="Campaña" value={account.id_campania} />
                  <DetailItem label="Folio" value={account.folio} />
                  <DetailItem label="ID cliente" value={account.id_cliente} />
                  <DetailItem
                    label="Ejecutivo"
                    value={account.ejecutivo_nombre || 'Sin asignar'}
                  />
                  <DetailItem
                    label="Estado actual"
                    value={
                      CARTERA_ESTADO_LABEL[
                        account.estado_gestion
                      ] || account.estado_gestion
                    }
                  />
                  <DetailItem
                    label="Fecha de cartera"
                    value={formatDate(account.ultima_fecha_cartera)}
                  />
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-lg font-bold">
                  Contacto
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[1, 2, 3, 4].map(index => {
                    const phone = account[`telefono_${index}`]

                    return (
                      <DetailItem
                        key={index}
                        label={`Teléfono ${index}`}
                        value={phone ? (
                          <a
                            href={`tel:${phone}`}
                            className="text-blue-600 hover:underline"
                          >
                            {phone}
                          </a>
                        ) : '—'}
                      />
                    )
                  })}

                  {[1, 2].map(index => {
                    const email = account[`correo_${index}`]

                    return (
                      <DetailItem
                        key={index}
                        label={`Correo ${index}`}
                        value={email ? (
                          <a
                            href={`mailto:${email}`}
                            className="text-blue-600 hover:underline"
                          >
                            {email}
                          </a>
                        ) : '—'}
                      />
                    )
                  })}
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-lg font-bold">
                  Información financiera
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <DetailItem label="Saldo" value={formatMoney(account.saldo)} />
                  <DetailItem
                    label="Pago requerido"
                    value={formatMoney(account.pago_requerido)}
                  />
                  <DetailItem
                    label="Pago mínimo"
                    value={formatMoney(account.pago_minimo)}
                  />
                  <DetailItem
                    label="Abono puntual"
                    value={formatMoney(account.abono_puntual)}
                  />
                  <DetailItem
                    label="Abono semanal"
                    value={formatMoney(account.abono_semanal)}
                  />
                  <DetailItem label="Días de atraso" value={account.dias_atraso} />
                  <DetailItem
                    label="Semanas de atraso"
                    value={account.semanas_atraso}
                  />
                  <DetailItem
                    label="Próximo pago"
                    value={formatDate(account.fecha_proxima_pago)}
                  />
                  <DetailItem
                    label="Vencimiento"
                    value={formatDate(account.fecha_vencimiento)}
                  />
                </div>
              </section>

                {account.datos_origen
                && Object.keys(account.datos_origen).length > 0
                && (
                  <section>
                    <h3 className="text-lg font-bold">
                      Expediente completo de origen
                    </h3>
                    <p className="mb-3 mt-1 text-sm text-gray-600">
                      Información recibida en la descarga original,
                      organizada sin eliminar campos.
                    </p>
                    <div className="space-y-3">
                      {SOURCE_DETAIL_SECTIONS.map(section => (
                        <SourceDataSection
                          key={section.title}
                          section={section}
                          data={account.datos_origen}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>

              <div
                role="tabpanel"
                aria-label="Gestiones de la cuenta"
                className={activeTab === 'management'
                  ? 'space-y-6'
                  : 'hidden'}
              >
                <section className="rounded-2xl border border-orange-200 bg-orange-50/40 p-5">
                <h3 className="text-lg font-bold">
                  Registrar gestión
                </h3>
                <p className="mt-1 text-sm text-gray-600">
                  El sistema tomará automáticamente cuenta, asesor,
                  cartera, fecha y estado resultante.
                </p>

                {account.pago_validacion_estado === 'pendiente' && (
                  <div className="mt-4 rounded-xl border border-amber-300 bg-amber-100 p-4 text-sm text-amber-900">
                    <p className="font-bold">
                      Pago reportado · pendiente de validación administrativa
                    </p>
                    <p className="mt-1">
                      La cuenta permanece asignada, pero no admite otra
                      gestión hasta que un administrador apruebe o rechace
                      el reporte.
                    </p>
                  </div>
                )}

                <form
                  onSubmit={registerManagement}
                  className="mt-4 space-y-4"
                >
                  <label className="block text-sm font-bold">
                    Tipificación
                    <select
                      required
                      value={management.tipificacion_id}
                      onChange={event =>
                        selectTypification(event.target.value)
                      }
                      className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
                    >
                      <option value="">
                        Seleccione el resultado
                      </option>
                      {typifications.map(item => (
                        <option key={item.id} value={item.id}>
                          {`P${item.prioridad} · ${item.nombre}`}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedTypification && (
                    <div className="rounded-xl border border-orange-200 bg-white p-3 text-sm text-gray-600">
                      Estado resultante:{' '}
                      <strong>
                        {
                          CARTERA_ESTADO_LABEL[
                            selectedTypification.estado_resultante
                          ] || selectedTypification.estado_resultante
                        }
                      </strong>
                      {selectedTypification.requiere_promesa
                        ? ' · Requiere promesa'
                        : ''}
                      {selectedTypification.requiere_seguimiento
                        ? ' · Requiere seguimiento'
                        : ''}
                      {selectedTypification.requiere_validacion_pago
                        ? ' · Requiere validación administrativa'
                        : ''}
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold">
                      Canal
                      <select
                        required
                        value={management.canal}
                        onChange={event =>
                          updateManagement('canal', event.target.value)
                        }
                        className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
                      >
                        {GESTION_CANALES.map(item => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="text-sm font-bold">
                      Teléfono utilizado
                      <input
                        value={management.telefono_contactado}
                        onChange={event =>
                          updateManagement(
                            'telefono_contactado',
                            event.target.value
                          )
                        }
                        required={[
                          'telefono',
                          'whatsapp',
                          'sms'
                        ].includes(management.canal)}
                        maxLength={100}
                        className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
                      />
                    </label>

                    <label className="text-sm font-bold">
                      Persona contactada
                      <input
                        value={management.persona_contactada}
                        onChange={event =>
                          updateManagement(
                            'persona_contactada',
                            event.target.value
                          )
                        }
                        maxLength={200}
                        placeholder="Nombre o referencia"
                        className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
                      />
                    </label>

                    <label className="text-sm font-bold">
                      Relación
                      <select
                        required
                        value={management.relacion_contacto}
                        onChange={event =>
                          updateManagement(
                            'relacion_contacto',
                            event.target.value
                          )
                        }
                        className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
                      >
                        {GESTION_RELACIONES.map(item => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {selectedTypification?.requiere_promesa && (
                    <div className="grid gap-3 rounded-xl border border-green-200 bg-green-50 p-4 sm:grid-cols-2">
                      <label className="text-sm font-bold">
                        Monto prometido
                        <input
                          type="number"
                          required
                          min="0.01"
                          step="0.01"
                          value={management.promesa_monto}
                          onChange={event =>
                            updateManagement(
                              'promesa_monto',
                              event.target.value
                            )
                          }
                          className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
                        />
                      </label>

                      <label className="text-sm font-bold">
                        Fecha de promesa
                        <input
                          type="date"
                          required
                          value={management.promesa_fecha}
                          onChange={event =>
                            updateManagement(
                              'promesa_fecha',
                              event.target.value
                            )
                          }
                          className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
                        />
                      </label>
                    </div>
                  )}

                  <label className="block text-sm font-bold">
                    Próximo seguimiento
                    <input
                      type="datetime-local"
                      required={
                        selectedTypification?.requiere_seguimiento
                        === true
                      }
                      value={management.proximo_seguimiento_at}
                      onChange={event =>
                        updateManagement(
                          'proximo_seguimiento_at',
                          event.target.value
                        )
                      }
                      className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
                    />
                  </label>

                  <label className="block text-sm font-bold">
                    Código operativo anterior
                    <input
                      value={management.codigo_resultado}
                      onChange={event =>
                        updateManagement(
                          'codigo_resultado',
                          event.target.value.toUpperCase()
                        )
                      }
                      maxLength={30}
                      placeholder="Opcional: ADD, REC3, NC…"
                      className="mt-1 w-full rounded-xl border bg-white p-3 font-normal uppercase"
                    />
                  </label>

                  <label className="block text-sm font-bold">
                    Notas
                    <textarea
                      required={!management.evidencia}
                      value={management.notas}
                      onChange={event =>
                        updateManagement('notas', event.target.value)
                      }
                      maxLength={2000}
                      rows={4}
                      placeholder="Describa el resultado de la gestión"
                      className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
                    />
                  </label>

                  <label className="block text-sm font-bold">
                    Referencia de evidencia
                    <input
                      required={
                        selectedTypification?.requiere_validacion_pago
                        === true
                      }
                      value={management.evidencia}
                      onChange={event =>
                        updateManagement('evidencia', event.target.value)
                      }
                      maxLength={1000}
                      placeholder={
                        selectedTypification?.requiere_validacion_pago
                          ? 'Obligatoria: folio, comprobante o documento'
                          : 'Opcional: folio, grabación o documento'
                      }
                      className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
                    />
                  </label>

                  <button
                    type="submit"
                    disabled={
                      saving
                      || typifications.length === 0
                      || account.pago_validacion_estado === 'pendiente'
                    }
                    className="rounded-xl bg-orange-600 px-5 py-3 font-normal text-white disabled:bg-gray-300"
                  >
                    Registrar gestión
                  </button>
                </form>
              </section>

              {isAdministrator && (
                <section className="rounded-2xl border border-purple-200 bg-purple-50 p-5">
                  <h3 className="text-lg font-bold">
                    Reasignación administrativa
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">
                    La operación quedará registrada en el historial.
                  </p>

                  <form onSubmit={reassign} className="mt-4 space-y-3">
                    <select
                      required
                      value={executiveId}
                      onChange={event =>
                        setExecutiveId(event.target.value)
                      }
                      className="w-full rounded-xl border bg-white p-3 font-normal"
                    >
                      <option value="">Seleccione un ejecutivo</option>
                      {executives.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.nombre}
                        </option>
                      ))}
                    </select>

                    <textarea
                      required
                      minLength={5}
                      maxLength={1000}
                      value={reason}
                      onChange={event => setReason(event.target.value)}
                      rows={3}
                      placeholder="Motivo de la reasignación"
                      className="w-full rounded-xl border bg-white p-3 font-normal"
                    />

                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-xl bg-purple-700 px-5 py-3 font-normal text-white disabled:bg-gray-300"
                    >
                      Reasignar cuenta
                    </button>
                  </form>
                </section>
              )}
              </div>

              <section
                role="tabpanel"
                aria-label="Auditoría de la cuenta"
                className={activeTab === 'audit' ? '' : 'hidden'}
              >
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-orange-600">
                      Trazabilidad completa
                    </p>
                    <h3 className="mt-1 text-2xl font-bold">
                      Auditoría e historial
                    </h3>
                  </div>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600">
                    {history.length} movimientos
                  </span>
                </div>

                {history.length === 0 && (
                  <p className="mt-3 rounded-xl bg-gray-50 p-4 text-gray-500">
                    Esta cuenta aún no tiene movimientos.
                  </p>
                )}

                <div className="mt-3 space-y-3">
                  {history.map(item => (
                    <article
                      key={item.id}
                      className="rounded-2xl border p-4 sm:p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-bold">
                          {item.tipificacion_nombre || item.evento}
                        </p>
                        <time className="text-xs text-gray-500">
                          {formatDateTime(item.creada_at)}
                        </time>
                      </div>

                      {item.gestion_id && (
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <span className="rounded-full bg-orange-100 px-2 py-1 text-orange-800">
                            {`Prioridad ${item.prioridad}`}
                          </span>
                          <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-800">
                            {item.canal}
                          </span>
                          {item.codigo_resultado && (
                            <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-700">
                              {item.codigo_resultado}
                            </span>
                          )}
                        </div>
                      )}

                      {item.telefono_contactado && (
                        <p className="mt-2 text-sm text-gray-700">
                          Teléfono: {item.telefono_contactado}
                        </p>
                      )}
                      {item.persona_contactada && (
                        <p className="mt-1 text-sm text-gray-700">
                          Contacto: {item.persona_contactada}
                          {item.relacion_contacto
                            ? ` · ${item.relacion_contacto}`
                            : ''}
                        </p>
                      )}
                      {item.promesa_monto && (
                        <p className="mt-1 text-sm text-green-700">
                          Promesa: {formatMoney(item.promesa_monto)}
                          {` · ${formatDate(item.promesa_fecha)}`}
                          {item.promesa_estado
                            ? ` · ${item.promesa_estado}`
                            : ''}
                        </p>
                      )}
                      {item.proximo_seguimiento_at && (
                        <p className="mt-1 text-sm text-purple-700">
                          Seguimiento:{' '}
                          {formatDateTime(item.proximo_seguimiento_at)}
                        </p>
                      )}
                      {item.detalle && (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
                          {item.detalle}
                        </p>
                      )}
                      {item.evidencia && (
                        <p className="mt-1 break-words text-sm text-gray-600">
                          Evidencia: {item.evidencia}
                        </p>
                      )}
                      <p className="mt-2 text-xs text-gray-500">
                        Usuario: {item.usuario_nombre || 'Sistema'}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
