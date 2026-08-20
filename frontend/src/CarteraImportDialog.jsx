import {
  useMemo,
  useState
} from 'react'

import { apiFetch } from './api'
import { formatMoney } from './cartera.constants'

function localDate() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60000

  return new Date(now.getTime() - offset)
    .toISOString()
    .slice(0, 10)
}

function wait(milliseconds) {
  return new Promise(resolve => {
    window.setTimeout(resolve, milliseconds)
  })
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

function uploadBody({
  file,
  originId,
  date,
  sha256
}) {
  const body = new FormData()

  body.append('archivo', file)
  body.append('origen_id', originId)
  body.append('fecha', date)

  if (sha256) {
    body.append('confirmacion_sha256', sha256)
  }

  return body
}

function ResultSummary({ job }) {
  const result = job?.result

  if (!result || job.status !== 'completed') {
    return null
  }

  const alreadyImported = result.status === 'already_imported'

  return (
    <div className="mt-5 rounded-2xl border border-green-300 bg-green-50 p-4 text-green-800">
      <p className="font-bold">
        {alreadyImported
          ? 'El archivo ya había sido importado'
          : 'Importación terminada correctamente'}
      </p>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <p>
          Registros: <strong>{result.totalRows ?? 0}</strong>
        </p>
        <p>
          Nuevos: <strong>{result.newRecords ?? 0}</strong>
        </p>
        <p>
          Actualizados: <strong>{result.updatedRecords ?? 0}</strong>
        </p>
        <p>
          Asignados: <strong>{result.assignedRecords ?? 0}</strong>
        </p>
      </div>
    </div>
  )
}

export default function CarteraImportDialog({
  origins,
  onClose,
  onImported
}) {
  const availableOrigins = useMemo(
    () => origins.filter(item => (
      Number(item.integraciones_activas || 0) > 0
    )),
    [origins]
  )
  const defaultOrigin = (
    availableOrigins.find(item => (
      item.codigo === 'banco_azteca'
    ))
    || availableOrigins[0]
  )
  const [originId, setOriginId] = useState(
    () => String(defaultOrigin?.id || '')
  )
  const [date, setDate] = useState(localDate)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [job, setJob] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const effectiveOriginId = (
    originId
    || String(defaultOrigin?.id || '')
  )

  const resetValidation = () => {
    setPreview(null)
    setConfirmed(false)
    setJob(null)
    setError('')
  }

  const selectFile = event => {
    const selected = event.target.files?.[0] || null

    setFile(selected)
    resetValidation()
  }

  const validateFile = async event => {
    event.preventDefault()

    if (!file || !effectiveOriginId || !date) {
      setError('Seleccione origen, fecha y archivo antes de validar.')
      return
    }

    setBusy('preview')
    setError('')
    setPreview(null)
    setConfirmed(false)
    setJob(null)

    try {
      const response = await apiFetch(
        '/crm-api/cartera/importaciones/preview',
        {
          method: 'POST',
          body: uploadBody({
            file,
            originId: effectiveOriginId,
            date
          })
        }
      )
      const data = await readJson(
        response,
        'No fue posible validar la descarga SCL'
      )

      setPreview(data.preview)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy('')
    }
  }

  const pollJob = async jobId => {
    for (let attempt = 0; attempt < 600; attempt++) {
      await wait(2000)

      const response = await apiFetch(
        `/crm-api/cartera/importaciones/trabajos/${jobId}`
      )
      const data = await readJson(
        response,
        'No fue posible consultar el avance de la importación'
      )

      setJob(data.job)

      if (data.job.status === 'completed') {
        onImported()
        return data.job
      }

      if (data.job.status === 'failed') {
        throw new Error(
          data.job.error?.message
          || 'La importación no pudo completarse'
        )
      }
    }

    throw new Error(
      'La importación sigue ejecutándose. Actualice la cartera en unos minutos.'
    )
  }

  const confirmImport = async () => {
    if (!preview || !confirmed || !file) {
      setError('Confirme la vista previa antes de importar.')
      return
    }

    setBusy('confirm')
    setError('')

    try {
      const response = await apiFetch(
        '/crm-api/cartera/importaciones/confirm',
        {
          method: 'POST',
          body: uploadBody({
            file,
            originId: effectiveOriginId,
            date,
            sha256: preview.sha256
          })
        }
      )
      const data = await readJson(
        response,
        'No fue posible iniciar la importación'
      )

      setJob(data.job)
      await pollJob(data.job.id)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy('')
    }
  }

  const importing = busy === 'confirm'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 p-4 sm:p-8">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="cartera-import-title"
        className="w-full max-w-4xl rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-orange-600">
              IMPORTACIÓN CONTROLADA
            </p>
            <h2
              id="cartera-import-title"
              className="mt-1 text-3xl font-bold"
            >
              Importar descarga SCL
            </h2>
            <p className="mt-2 text-gray-500">
              Primero se valida el archivo. La cartera no cambia hasta confirmar.
            </p>
          </div>

          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={onClose}
            className="rounded-xl border px-4 py-2 disabled:opacity-40"
          >
            Cerrar
          </button>
        </div>

        <form
          onSubmit={validateFile}
          className="mt-6 rounded-2xl border bg-gray-50 p-5"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              Origen
              <select
                required
                value={effectiveOriginId}
                disabled={Boolean(busy)}
                onChange={event => {
                  setOriginId(event.target.value)
                  resetValidation()
                }}
                className="mt-2 w-full rounded-xl border bg-white p-3"
              >
                <option value="">Seleccione un origen</option>
                {availableOrigins.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.nombre}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              Fecha de cartera
              <input
                required
                type="date"
                value={date}
                disabled={Boolean(busy)}
                onChange={event => {
                  setDate(event.target.value)
                  resetValidation()
                }}
                className="mt-2 w-full rounded-xl border bg-white p-3"
              />
            </label>

            <label className="text-sm md:col-span-2">
              Archivo descargado del SCL
              <input
                required
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={Boolean(busy)}
                onChange={selectFile}
                className="mt-2 block w-full rounded-xl border bg-white p-3"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={Boolean(busy) || !file || !effectiveOriginId}
            className="mt-5 rounded-xl bg-gray-900 px-5 py-3 text-white disabled:bg-gray-300"
          >
            {busy === 'preview'
              ? 'Validando archivo…'
              : 'Validar y generar vista previa'}
          </button>
        </form>

        {error && (
          <div
            role="alert"
            className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-4 text-red-700"
          >
            {error}
          </div>
        )}

        {preview && (
          <div className="mt-5 rounded-2xl border border-orange-200 bg-orange-50 p-5">
            <h3 className="text-xl font-bold">
              Archivo válido y listo para confirmar
            </h3>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <p>Registros: <strong>{preview.totalRows}</strong></p>
              <p>Campos: <strong>{preview.fields}</strong></p>
              <p>Campañas: <strong>{preview.campaigns}</strong></p>
              <p>Con teléfono: <strong>{preview.accountsWithPhone}</strong></p>
              <p>Origen: <strong>{preview.origin.name}</strong></p>
              <p>Fecha: <strong>{preview.date}</strong></p>
              <p>
                Saldo total: <strong>{formatMoney(preview.totalBalance)}</strong>
              </p>
              <p>Formato: <strong>Descarga SCL</strong></p>
            </div>

            <label className="mt-5 flex items-start gap-3 rounded-xl bg-white p-4">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={Boolean(busy)}
                onChange={event => setConfirmed(event.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <span className="text-sm">
                Confirmo que el origen y la fecha son correctos y autorizo
                importar <strong>{preview.totalRows}</strong> cuentas.
              </span>
            </label>

            <button
              type="button"
              disabled={!confirmed || Boolean(busy)}
              onClick={confirmImport}
              className="mt-4 rounded-xl bg-orange-600 px-5 py-3 font-bold text-white disabled:bg-gray-300"
            >
              {importing
                ? 'Importando cartera…'
                : 'Confirmar e importar cartera'}
            </button>
          </div>
        )}

        {job && ['queued', 'processing'].includes(job.status) && (
          <div
            role="status"
            className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-800"
          >
            <p className="font-bold">Importación en proceso</p>
            <p className="mt-1 text-sm">
              Puede tardar varios minutos. No cierre ni reinicie el backend.
            </p>
          </div>
        )}

        <ResultSummary job={job} />
      </section>
    </div>
  )
}
