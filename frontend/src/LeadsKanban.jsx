export default function LeadsKanban({
  leads,
  onLeadClick,
  onCambiarEstado
}) {

  const estados = [
    'Nuevo',
    'Contactado',
    'Seguimiento',
    'Ganado',
    'Perdido'
  ]

const colores = {
  Nuevo: 'border-yellow-400 bg-yellow-50',
  Contactado: 'border-blue-400 bg-blue-50',
  Seguimiento: 'border-purple-400 bg-purple-50',
  Ganado: 'border-green-400 bg-green-50',
  Perdido: 'border-red-400 bg-red-50'
}

const obtenerColorLead = (lead) => {

  if (!lead.proximo_contacto) {
    return 'border-gray-200'
  }

  const hoy = new Date()
  hoy.setHours(0,0,0,0)

  const fecha = new Date(lead.proximo_contacto)
  fecha.setHours(0,0,0,0)

  if (fecha < hoy) {
    return 'border-red-500 bg-red-50'
  }

  if (fecha.getTime() === hoy.getTime()) {
    return 'border-orange-500 bg-orange-50'
  }

  return 'border-green-300'
}

  return (

    <div className="grid grid-cols-5 gap-4">

      {estados.map((estado) => (

        <div
          key={estado}
          className={`rounded-xl p-3 border-2 ${colores[estado]}`}
        >

          <h3 className="font-bold text-lg mb-3 flex justify-between">
  <span>{estado}</span>

  <span className="bg-white px-2 rounded-full text-sm">
    {
      leads.filter(
        lead => lead.estado === estado
      ).length
    }
  </span>
</h3>

          {leads
            .filter(
              lead => lead.estado === estado
            )
            .map((lead) => (

              <div
                key={lead.id}
                onClick={() => onLeadClick(lead)}
               className={`
  bg-white
  rounded-lg
  p-3
  mb-2
  shadow
  cursor-pointer
  hover:shadow-xl
  transition
  border-2
  ${obtenerColorLead(lead)}
`}
              >

                <div className="font-semibold">
                  {lead.nombre}
                </div>

                {lead.proximo_contacto && (
  new Date(lead.proximo_contacto) < new Date(new Date().setHours(0,0,0,0))
) && (

  <div className="text-red-600 text-xs font-bold mb-1">
    🔴 Seguimiento vencido
  </div>

)}

                <div className="text-sm text-gray-500">
                  {lead.empresa}
                </div>

<div className="text-xs text-gray-600 mt-2">

  <div className="text-xs text-gray-600">
  👤 {lead.usuario_nombre || 'Sin asignar'}
</div>

<div className="text-xs text-gray-600">
   📅 {lead.proximo_contacto
    ? new Date(lead.proximo_contacto)
        .toLocaleDateString('es-MX')
    : 'Sin fecha'} 

</div>

<div className="text-xs text-orange-600 font-semibold">
  🔥 {lead.prioridad}
</div>

</div>
                <select
  value={lead.estado}
  onClick={(e) => e.stopPropagation()}
  onChange={(e) =>
    onCambiarEstado(
      lead.id,
      e.target.value
    )
  }
  className="mt-2 w-full border rounded p-1 text-sm"
>
  <option>Nuevo</option>
  <option>Contactado</option>
  <option>Seguimiento</option>
  <option>Ganado</option>
  <option>Perdido</option>
</select>

              </div>

            ))}

        </div>

      ))}

    </div>

  )

}
