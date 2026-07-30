import {
  useCallback,
  useEffect,
  useState
} from 'react'

import { apiFetch } from './api'

import {
  CARTERA_ESTADOS,
  CARTERA_ESTADO_LABEL,
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
      <div className="mt-1 break-words font-semibold">
        {value ?? '—'}
      </div>
    </div>
  )
}

export default function CarteraDrawer({
  accountId,
  usuario,
  executives,
  onClose,
  onChanged
}) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [state, setState] = useState('')
  const [stateDetail, setStateDetail] = useState('')
  const [note, setNote] = useState('')
  const [executiveId, setExecutiveId] = useState('')
  const [reason, setReason] = useState('')

  const isAdministrator =
    usuario?.rol !== 'Ejecutivo'

  const loadDetail = useCallback(async signal => {
    setLoading(true)
    setError('')

    try {
      const response = await apiFetch(
        `/crm-api/cartera/${accountId}`,
        {
          signal
        }
      )
      const data = await readJson(
        response,
        'No fue posible consultar la cuenta'
      )

      setDetail(data)
      setState(data.account?.estado_gestion || '')
      setExecutiveId(
        String(data.account?.ejecutivo_id || '')
      )
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

  const reloadAfterChange = async () => {
    const controller = new AbortController()
    await loadDetail(controller.signal)
    onChanged()
  }

  const updateState = async event => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')

    try {
      const response = await apiFetch(
        `/crm-api/cartera/${accountId}/estado`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            estado: state,
            detalle: stateDetail
          })
        }
      )

      const data = await readJson(
        response,
        'No fue posible actualizar el estado'
      )

      setStateDetail('')
      setMessage(
        data.changed
          ? 'Estado actualizado correctamente.'
          : 'La cuenta ya tenía ese estado.'
      )
      await reloadAfterChange()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  const addNote = async event => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')

    try {
      const response = await apiFetch(
        `/crm-api/cartera/${accountId}/notas`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            nota: note
          })
        }
      )

      await readJson(
        response,
        'No fue posible guardar la nota'
      )

      setNote('')
      setMessage('Nota agregada al historial.')
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-5">
          <div>
            <p className="text-xs font-bold text-orange-600">
              DETALLE DE CUENTA
            </p>
            <h2 className="text-2xl font-bold">
              {account?.nombre || 'Cargando cuenta…'}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
            className="rounded-lg bg-gray-900 px-4 py-2 font-bold text-white"
          >
            Cerrar
          </button>
        </div>

        <div className="space-y-6 p-6">
          {loading && (
            <p className="font-bold text-orange-600">
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
              <section>
                <h3 className="mb-3 text-lg font-bold">
                  Identidad y asignación
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <DetailItem
                    label="Campaña"
                    value={account.id_campania}
                  />
                  <DetailItem
                    label="Folio"
                    value={account.folio}
                  />
                  <DetailItem
                    label="ID cliente"
                    value={account.id_cliente}
                  />
                  <DetailItem
                    label="Ejecutivo"
                    value={
                      account.ejecutivo_nombre
                      || 'Sin asignar'
                    }
                  />
                  <DetailItem
                    label="Nivel de riesgo"
                    value={account.id_nivel_riesgo}
                  />
                  <DetailItem
                    label="Fecha de cartera"
                    value={formatDate(
                      account.ultima_fecha_cartera
                    )}
                  />
                </div>
              </section>

              <section>
                <h3 className="mb-3 text-lg font-bold">
                  Contacto
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[1, 2, 3, 4].map(index => {
                    const phone =
                      account[`telefono_${index}`]

                    return (
                      <DetailItem
                        key={index}
                        label={`Teléfono ${index}`}
                        value={
                          phone
                            ? (
                              <a
                                href={`tel:${phone}`}
                                className="text-blue-600 hover:underline"
                              >
                                {phone}
                              </a>
                            )
                            : '—'
                        }
                      />
                    )
                  })}

                  {[1, 2].map(index => {
                    const email =
                      account[`correo_${index}`]

                    return (
                      <DetailItem
                        key={index}
                        label={`Correo ${index}`}
                        value={
                          email
                            ? (
                              <a
                                href={`mailto:${email}`}
                                className="text-blue-600 hover:underline"
                              >
                                {email}
                              </a>
                            )
                            : '—'
                        }
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
                  <DetailItem
                    label="Saldo"
                    value={formatMoney(account.saldo)}
                  />
                  <DetailItem
                    label="Pago requerido"
                    value={formatMoney(
                      account.pago_requerido
                    )}
                  />
                  <DetailItem
                    label="Pago mínimo"
                    value={formatMoney(
                      account.pago_minimo
                    )}
                  />
                  <DetailItem
                    label="Abono puntual"
                    value={formatMoney(
                      account.abono_puntual
                    )}
                  />
                  <DetailItem
                    label="Abono semanal"
                    value={formatMoney(
                      account.abono_semanal
                    )}
                  />
                  <DetailItem
                    label="Días de atraso"
                    value={account.dias_atraso}
                  />
                  <DetailItem
                    label="Semanas de atraso"
                    value={account.semanas_atraso}
                  />
                  <DetailItem
                    label="Próximo pago"
                    value={formatDate(
                      account.fecha_proxima_pago
                    )}
                  />
                  <DetailItem
                    label="Vencimiento"
                    value={formatDate(
                      account.fecha_vencimiento
                    )}
                  />
                </div>
              </section>

              <section className="rounded-2xl border p-5">
                <h3 className="text-lg font-bold">
                  Estado de gestión
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Estado actual:{' '}
                  <strong>
                    {
                      CARTERA_ESTADO_LABEL[
                        account.estado_gestion
                      ] || account.estado_gestion
                    }
                  </strong>
                </p>

                <form
                  onSubmit={updateState}
                  className="mt-4 space-y-3"
                >
                  <select
                    required
                    value={state}
                    onChange={event =>
                      setState(event.target.value)
                    }
                    className="w-full rounded-xl border bg-white p-3"
                  >
                    {CARTERA_ESTADOS.map(item => (
                      <option
                        key={item.value}
                        value={item.value}
                      >
                        {item.label}
                      </option>
                    ))}
                  </select>

                  <input
                    value={stateDetail}
                    onChange={event =>
                      setStateDetail(event.target.value)
                    }
                    maxLength={1000}
                    placeholder="Detalle opcional del cambio"
                    className="w-full rounded-xl border p-3"
                  />

                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-xl bg-orange-600 px-5 py-3 font-bold text-white disabled:bg-gray-300"
                  >
                    Guardar estado
                  </button>
                </form>
              </section>

              <section className="rounded-2xl border p-5">
                <h3 className="text-lg font-bold">
                  Agregar nota
                </h3>
                <form
                  onSubmit={addNote}
                  className="mt-4"
                >
                  <textarea
                    required
                    value={note}
                    onChange={event =>
                      setNote(event.target.value)
                    }
                    maxLength={2000}
                    rows={4}
                    placeholder="Escriba el resultado de la gestión"
                    className="w-full rounded-xl border p-3"
                  />
                  <button
                    type="submit"
                    disabled={saving}
                    className="mt-3 rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:bg-gray-300"
                  >
                    Agregar nota
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

                  <form
                    onSubmit={reassign}
                    className="mt-4 space-y-3"
                  >
                    <select
                      required
                      value={executiveId}
                      onChange={event =>
                        setExecutiveId(event.target.value)
                      }
                      className="w-full rounded-xl border bg-white p-3"
                    >
                      <option value="">
                        Seleccione un ejecutivo
                      </option>
                      {executives.map(item => (
                        <option
                          key={item.id}
                          value={item.id}
                        >
                          {item.nombre}
                        </option>
                      ))}
                    </select>

                    <textarea
                      required
                      minLength={5}
                      maxLength={1000}
                      value={reason}
                      onChange={event =>
                        setReason(event.target.value)
                      }
                      rows={3}
                      placeholder="Motivo de la reasignación"
                      className="w-full rounded-xl border bg-white p-3"
                    />

                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-xl bg-purple-700 px-5 py-3 font-bold text-white disabled:bg-gray-300"
                    >
                      Reasignar cuenta
                    </button>
                  </form>
                </section>
              )}

              <section>
                <h3 className="text-lg font-bold">
                  Historial
                </h3>

                {history.length === 0 && (
                  <p className="mt-3 rounded-xl bg-gray-50 p-4 text-gray-500">
                    Esta cuenta aún no tiene movimientos.
                  </p>
                )}

                <div className="mt-3 space-y-3">
                  {history.map(item => (
                    <article
                      key={item.id}
                      className="rounded-xl border p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-bold">
                          {item.evento}
                        </p>
                        <time className="text-xs text-gray-500">
                          {formatDateTime(item.creada_at)}
                        </time>
                      </div>
                      {item.detalle && (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
                          {item.detalle}
                        </p>
                      )}
                      <p className="mt-2 text-xs text-gray-500">
                        Usuario: {
                          item.usuario_nombre
                          || 'Sistema'
                        }
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
