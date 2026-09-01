import { useCallback, useEffect, useMemo, useState } from 'react'

import { apiFetch } from './api'

const REFRESH_INTERVAL_MS = 30 * 1000

function formatDate(value) {
  if (!value) return '—'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City'
  }).format(date)
}

function describeDevice(userAgent) {
  const source = String(userAgent || '')

  if (!source) return 'Dispositivo no identificado'

  let browser = 'Navegador'
  let system = 'Equipo'

  if (/Edg\//i.test(source)) browser = 'Edge'
  else if (/Firefox\//i.test(source)) browser = 'Firefox'
  else if (/Chrome\//i.test(source)) browser = 'Chrome'
  else if (/Safari\//i.test(source)) browser = 'Safari'

  if (/Windows/i.test(source)) system = 'Windows'
  else if (/Android/i.test(source)) system = 'Android'
  else if (/iPhone|iPad/i.test(source)) system = 'iPhone/iPad'
  else if (/Macintosh|Mac OS/i.test(source)) system = 'macOS'
  else if (/Linux/i.test(source)) system = 'Linux'

  return `${browser} · ${system}`
}

function MetricCard({ label, value, tone }) {
  const tones = {
    blue: 'border-blue-300 bg-blue-50 text-blue-700',
    green: 'border-green-300 bg-green-50 text-green-700',
    orange: 'border-orange-300 bg-orange-50 text-orange-700',
    gray: 'border-gray-300 bg-gray-50 text-gray-700'
  }

  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <p className="text-xs font-bold uppercase tracking-wide">
        {label}
      </p>
      <p className="mt-2 text-3xl text-gray-950">
        {value}
      </p>
    </div>
  )
}

export default function SessionMonitor() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showRecent, setShowRecent] = useState(false)
  const [selected, setSelected] = useState(null)
  const [reason, setReason] = useState('')
  const [closing, setClosing] = useState(false)

  const loadSessions = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true)
    else setLoading(true)

    setError('')

    try {
      const response = await apiFetch('/crm-api/sesiones')
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(
          data?.error || 'No fue posible consultar las sesiones'
        )
      }

      setSessions(Array.isArray(data) ? data : [])
    } catch (loadError) {
      setError(
        loadError?.message
        || 'No fue posible consultar las sesiones'
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const initialLoadId = window.setTimeout(
      () => loadSessions(),
      0
    )

    const intervalId = window.setInterval(
      () => loadSessions({ quiet: true }),
      REFRESH_INTERVAL_MS
    )

    return () => {
      window.clearTimeout(initialLoadId)
      window.clearInterval(intervalId)
    }
  }, [loadSessions])

  const metrics = useMemo(() => {
    const active = sessions.filter(session => session.active)
    const online = active.filter(session => session.online)
    const users = new Set(active.map(session => session.userId))

    return {
      active: active.length,
      online: online.length,
      users: users.size,
      inactive: active.length - online.length
    }
  }, [sessions])

  const visibleSessions = useMemo(
    () => sessions.filter(session => (
      showRecent || session.active
    )),
    [sessions, showRecent]
  )

  async function closeRemoteSession() {
    if (!selected || closing) return

    setClosing(true)
    setError('')
    setNotice('')

    try {
      const response = await apiFetch(
        `/crm-api/sesiones/${selected.id}/cerrar`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ motivo: reason })
        }
      )
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(
          data?.error || 'No fue posible cerrar la sesión'
        )
      }

      setSelected(null)
      setReason('')
      setNotice(
        `La sesión de ${selected.userName} fue cerrada.`
      )
      await loadSessions({ quiet: true })
    } catch (closeError) {
      setError(
        closeError?.message || 'No fue posible cerrar la sesión'
      )
    } finally {
      setClosing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-orange-600">
            CONTROL DE ACCESO
          </p>
          <h1 className="mt-1 text-4xl font-bold">
            Monitor de sesiones
          </h1>
          <p className="mt-2 text-gray-500">
            Consulte los accesos activos y cierre una sesión cuando sea necesario.
          </p>
        </div>

        <button
          type="button"
          onClick={() => loadSessions({ quiet: true })}
          disabled={refreshing}
          className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 font-medium text-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {refreshing ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Sesiones activas"
            value={metrics.active}
            tone="blue"
          />
          <MetricCard
            label="En línea"
            value={metrics.online}
            tone="green"
          />
          <MetricCard
            label="Usuarios conectados"
            value={metrics.users}
            tone="orange"
          />
          <MetricCard
            label="Sin actividad reciente"
            value={metrics.inactive}
            tone="gray"
          />
        </div>
      </section>

      {notice && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-green-800">
          {notice}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-xl font-bold">Accesos registrados</h2>
            <p className="text-sm text-gray-500">
              “En línea” indica actividad durante los últimos minutos.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={showRecent}
              onChange={event => setShowRecent(event.target.checked)}
              className="h-4 w-4 accent-orange-500"
            />
            Mostrar cerradas recientes
          </label>
        </div>

        {loading ? (
          <div className="p-10 text-center text-gray-500">
            Consultando sesiones…
          </div>
        ) : visibleSessions.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            No hay sesiones para mostrar.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="px-5 py-3 font-bold">Usuario</th>
                  <th className="px-5 py-3 font-bold">Estado</th>
                  <th className="px-5 py-3 font-bold">Equipo</th>
                  <th className="px-5 py-3 font-bold">Dirección IP</th>
                  <th className="px-5 py-3 font-bold">Inicio</th>
                  <th className="px-5 py-3 font-bold">Última actividad</th>
                  <th className="px-5 py-3 font-bold">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {visibleSessions.map(session => (
                  <tr key={session.id} className="align-top">
                    <td className="px-5 py-4">
                      <p className="font-bold text-gray-950">
                        {session.userName}
                      </p>
                      <p className="text-xs text-gray-500">
                        {session.userRole} · {session.userEmail}
                      </p>
                      {session.current && (
                        <span className="mt-2 inline-flex rounded-full bg-blue-100 px-2 py-1 text-xs font-bold text-blue-700">
                          Sesión actual
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      {session.active ? (
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                          session.online
                            ? 'bg-green-100 text-green-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}>
                          {session.online ? 'En línea' : 'Sin actividad'}
                        </span>
                      ) : (
                        <>
                          <span className="inline-flex rounded-full bg-gray-200 px-2.5 py-1 text-xs font-bold text-gray-700">
                            Cerrada
                          </span>
                          <p className="mt-2 max-w-52 text-xs text-gray-500">
                            {session.closeReason || 'Sesión finalizada'}
                          </p>
                        </>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-700">
                      {describeDevice(session.userAgent)}
                    </td>
                    <td className="px-5 py-4 text-gray-700">
                      {session.ipAddress || '—'}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-gray-700">
                      {formatDate(session.startedAt)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-gray-700">
                      {formatDate(session.lastActivityAt)}
                    </td>
                    <td className="px-5 py-4">
                      {session.active && !session.current ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(session)
                            setReason('')
                            setNotice('')
                          }}
                          className="whitespace-nowrap rounded-lg bg-red-600 px-3 py-2 font-medium text-white hover:bg-red-700"
                        >
                          Cerrar sesión
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-session-title"
        >
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <h2 id="close-session-title" className="text-2xl font-bold">
              Cerrar sesión de {selected.userName}
            </h2>
            <p className="mt-2 text-gray-600">
              El acceso quedará invalidado y el usuario tendrá que iniciar sesión nuevamente.
            </p>

            <label className="mt-5 block text-sm font-bold text-gray-800">
              Motivo (opcional)
              <textarea
                value={reason}
                onChange={event => setReason(event.target.value)}
                maxLength={255}
                rows={3}
                placeholder="Ej. Equipo sin supervisión"
                className="mt-2 w-full rounded-xl border border-gray-300 p-3 font-normal outline-none focus:border-orange-500"
              />
            </label>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelected(null)
                  setReason('')
                }}
                disabled={closing}
                className="rounded-xl border border-gray-300 px-4 py-2.5 font-medium text-gray-800 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={closeRemoteSession}
                disabled={closing}
                className="rounded-xl bg-red-600 px-4 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {closing ? 'Cerrando…' : 'Confirmar cierre'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
