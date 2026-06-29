import { useEffect, useState } from 'react'
export default function LeadDrawer({
  lead,
  onClose
}) {

const [historial, setHistorial] = useState([])

useEffect(() => {

  if (!lead) return

  fetch(`/crm-api/leads/${lead.id}/historial`)
    .then(res => res.json())
    .then(data => setHistorial(data))
    .catch(console.error)

}, [lead])

  if (!lead) return null

  return (

    <div className="fixed inset-0 bg-black/30 z-50 flex justify-end">

      <div className="bg-white w-[450px] h-full shadow-2xl p-6 overflow-auto">

        <div className="flex justify-between items-center mb-6">

          <h2 className="text-2xl font-bold">
            {lead.nombre}
          </h2>

          <button
            onClick={onClose}
            className="bg-red-500 text-white px-3 py-1 rounded"
          >
            X
          </button>

        </div>

        <div className="space-y-4">

          <div>
            <strong>Empresa:</strong>
            <br />
            {lead.empresa}
          </div>

          <div>
            <strong>Teléfono:</strong>
            <br />
            {lead.telefono}
          </div>

          <div>
            <strong>Correo:</strong>
            <br />
            {lead.email}
          </div>

          <div>
            <strong>Estado:</strong>
            <br />
            {lead.estado}
          </div>

          <div>
            <strong>Prioridad:</strong>
            <br />
            {lead.prioridad}
          </div>

          <div>
            <strong>Necesidad:</strong>
            <br />
            {lead.necesidad}
          </div>

          <div>
            <strong>Próxima cita:</strong>
            <br />
            {lead.proximo_contacto
  ? new Date(lead.proximo_contacto)
      .toLocaleDateString('es-MX')
  : 'Sin fecha'}
          </div>

          <div>
            <strong>Notas:</strong>
            <br />
            {lead.notas}
          </div>
<hr className="my-6" />

<h3 className="text-xl font-bold">
  Historial
</h3>

<div className="space-y-3 mt-4">

  {historial.map(item => (

    <div
      key={item.id}
      className="border rounded-lg p-3 bg-gray-50"
    >

      <div className="font-semibold">
        {item.accion}
      </div>

      <div className="text-sm text-gray-600">
        {item.detalle}
      </div>

      <div className="text-xs text-gray-400 mt-1">
        {
          new Date(item.created_at)
            .toLocaleString('es-MX')
        }
      </div>

    </div>

  ))}

</div>


        </div>

      </div>

    </div>

  )

}
