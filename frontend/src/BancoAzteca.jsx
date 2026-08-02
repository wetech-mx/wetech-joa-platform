import { useEffect, useState } from 'react'
import { apiFetch } from './api'

function localDate() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

function fileNameFrom(response, fallback) {
  const disposition = response.headers.get('content-disposition') || ''
  const match = disposition.match(/filename="([^"]+)"/i)
  return match?.[1] || fallback
}

export default function BancoAzteca() {
  const [fecha, setFecha] = useState(localDate)
  const [estado, setEstado] = useState({
    loading: true,
    configured: false,
    invalid: false
  })
  const [downloading, setDownloading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true

    apiFetch('/crm-api/banco-azteca/estado')
      .then(async response => {
        const data = await response.json()
        if (!response.ok) {
          throw new Error(data.error || 'No fue posible revisar el conector')
        }
        return data
      })
      .then(data => {
        if (active) {
          setEstado({
            loading: false,
            configured: data.configured,
            invalid: Boolean(data.invalid)
          })
        }
      })
      .catch(error => {
        if (active) {
          setEstado({
            loading: false,
            configured: false,
            invalid: false
          })
          setMessage(error.message)
        }
      })

    return () => {
      active = false
    }
  }, [])

  const descargar = async event => {
    event.preventDefault()
    setDownloading(true)
    setMessage('')

    try {
      const response = await apiFetch(
        '/crm-api/banco-azteca/exportar',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fecha })
        }
      )

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(
          data.error || 'No fue posible descargar la cartera'
        )
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileNameFrom(
        response,
        `Cartera_BancoAzteca_${fecha}.xlsx`
      )
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setMessage('Excel generado y descargado correctamente.')
    } catch (error) {
      setMessage(error.message)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <section className="max-w-3xl">
      <p className="text-sm font-bold text-orange-600">
        CONECTOR V0.6.0
      </p>
      <h1 className="text-4xl font-bold mt-1">
        Banco Azteca
      </h1>
      <p className="text-gray-500 mt-2">
        Descarga la cartera autorizada directamente en Excel.
      </p>

      <div className="bg-white rounded-2xl shadow p-6 mt-8">
        {estado.loading && (
          <p>Verificando configuración del conector…</p>
        )}

        {!estado.loading && !estado.configured && (
          <div className="border border-amber-300 bg-amber-50 rounded-xl p-4">
            <p className="font-bold">Conector pendiente de configuración</p>
            <p className="text-sm text-gray-600 mt-1">
              {estado.invalid
                ? 'La configuración existe, pero contiene un valor inválido.'
                : 'Un administrador del servidor debe registrar las credenciales y parámetros bancarios.'}
              {' '}Las claves nunca se muestran aquí.
            </p>
          </div>
        )}

        {!estado.loading && estado.configured && (
          <div className="border border-green-300 bg-green-50 rounded-xl p-4">
            <p className="font-bold text-green-800">
              Conector configurado
            </p>
            <p className="text-sm text-green-700 mt-1">
              La descarga se realiza en memoria y no conserva el Excel
              dentro del servidor.
            </p>
          </div>
        )}

        <form onSubmit={descargar} className="mt-6">
          <label className="block font-bold" htmlFor="fecha-banco">
            Fecha de consulta
          </label>
          <input
            id="fecha-banco"
            type="date"
            required
            value={fecha}
            onChange={event => setFecha(event.target.value)}
            className="border rounded-lg p-3 mt-2 w-full"
          />

          <button
            type="submit"
            disabled={!estado.configured || downloading}
            className="bg-orange-600 disabled:bg-gray-300 text-white font-bold px-5 py-3 rounded-lg mt-5"
          >
            {downloading
              ? 'Consultando banco…'
              : 'Descargar cartera en Excel'}
          </button>
        </form>

        {message && (
          <p className="mt-4 text-sm" role="status">
            {message}
          </p>
        )}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 mt-6">
        <p className="font-bold">Seguridad de esta versión</p>
        <ul className="list-disc pl-5 mt-2 text-sm text-gray-700 space-y-1">
          <li>Solo Administrador o Super Admin puede ingresar.</li>
          <li>Los tokens y llaves no se envían al navegador.</li>
          <li>El archivo se genera en memoria y se entrega por HTTPS.</li>
          <li>Los errores no muestran respuestas sensibles del banco.</li>
        </ul>
      </div>
    </section>
  )
}
