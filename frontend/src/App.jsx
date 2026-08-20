import LeadDrawer from './LeadDrawer'

import { useEffect, useState } from 'react'

import Usuarios from './Usuarios'

import LeadsKanban from './LeadsKanban'

import Login from './Login'
import BancoAzteca from './BancoAzteca'
import Cartera from './Cartera'
import CarteraDashboard from './CarteraDashboard'
import CarteraGestiones from './CarteraGestiones'
import CarteraTipificaciones from './CarteraTipificaciones'
import Integraciones from './Integraciones'
import { apiFetch } from './api'

export default function App() {

const [leadSeleccionado, setLeadSeleccionado] = useState(null)

const [usuario, setUsuario] = useState(
  JSON.parse(localStorage.getItem('usuario'))
)

const [pantalla, setPantalla] = useState('dashboard')

const [vista, setVista] = useState('tabla')

const [leads, setLeads] = useState([])

const [usuarios, setUsuarios] = useState([])

const [busqueda, setBusqueda] = useState('')

const [orden, setOrden] = useState('estado')
const [filtroEstado, setFiltroEstado] = useState('todos')

const [alertas, setAlertas] = useState({
  vencidos: [],
  hoy: []
})

const leadsDashboard =
  usuario?.rol === 'Ejecutivo'
    ? leads.filter(
        lead => lead.usuario_id === usuario.id
      )
    : leads

const totalLeads = leadsDashboard.length


const nuevos = leadsDashboard.filter(
  lead => lead.estado === 'Nuevo'
).length

const contactados = leadsDashboard.filter(
  lead => lead.estado === 'Contactado'
).length

const ganados = leadsDashboard.filter(
  lead => lead.estado === 'Ganado'
).length

const perdidos = leadsDashboard.filter(
  lead => lead.estado === 'Perdido'
).length
 
const actualizarEstado = async (id, nuevoEstado) => {

  try {

    const response = await apiFetch(`/crm-api/leads/${id}/estado`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        estado: nuevoEstado
      })
    })

    if (!response.ok) {
      throw new Error('No fue posible actualizar el estado')
    }

    setLeads(
      current => current.map((lead) =>
        lead.id === id
          ? { ...lead, estado: nuevoEstado }
          : lead
      )
    )

  } catch (error) {

    console.error(error)

  }

} 

const actualizarFecha = async (id, fecha) => {

  try {

    const response = await apiFetch(`/crm-api/leads/${id}/fecha`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        proximo_contacto: fecha
      })
    })

    if (!response.ok) {
      throw new Error('No fue posible actualizar la fecha')
    }

    setLeads(
      current => current.map((lead) =>
        lead.id === id
          ? { ...lead, proximo_contacto: fecha }
          : lead
      )
    )

  } catch (error) {

    console.error(error)

  }

} 

const importarLeads = async (e) => {

  const archivo = e.target.files[0]

  if (!archivo) return

  const formData = new FormData()

  formData.append('archivo', archivo)

  try {

    const res = await apiFetch(
      '/crm-api/importar-leads',
      {
        method: 'POST',
        body: formData
      }
    )

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      throw new Error(
        data.error || 'No fue posible importar el archivo'
      )
    }

    alert(
      `${data.importados} leads importados`
    )

    window.location.reload()

  } catch(error) {

    console.error(error)

    alert('Error importando archivo')

  }

}

const asignarLead = async (id, usuario_id) => {

  try {

    const response = await apiFetch(`/crm-api/leads/${id}/asignar`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        usuario_id
      })
    })

    if (!response.ok) {
      throw new Error('No fue posible asignar el lead')
    }

    setLeads(
      current => current.map((lead) =>
        lead.id === id
          ? { ...lead, usuario_id }
          : lead
      )
    )

  } catch (error) {

    console.error(error)

  }

}

const actualizarNotas = async (id, notas) => {

  try {

    const response = await apiFetch(`/crm-api/leads/${id}/notas`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        notas
      })
    })

    if (!response.ok) {
      throw new Error('No fue posible actualizar las notas')
    }

    setLeads(
      current => current.map((lead) =>
        lead.id === id
          ? { ...lead, notas }
          : lead
      )
    )

  } catch (error) {

    console.error(error)

  }

}


useEffect(() => {

  if (!usuario) return undefined

  let active = true

  async function cargarDatosIniciales() {
    try {
      const responses = await Promise.all([
        apiFetch('/crm-api/leads'),
        apiFetch('/crm-api/alertas'),
        apiFetch('/crm-api/usuarios-activos')
      ])

      for (const response of responses) {
        if (!response.ok) {
          throw new Error(
            `Error HTTP ${response.status}`
          )
        }
      }

      const [
        leadsData,
        alertasData,
        usuariosData
      ] = await Promise.all(
        responses.map(response => response.json())
      )

      if (!active) return

      setLeads(
        Array.isArray(leadsData)
          ? leadsData
          : []
      )

      setAlertas({
        vencidos: Array.isArray(
          alertasData?.vencidos
        )
          ? alertasData.vencidos
          : [],
        hoy: Array.isArray(alertasData?.hoy)
          ? alertasData.hoy
          : []
      })

      setUsuarios(
        Array.isArray(usuariosData)
          ? usuariosData
          : []
      )
    } catch (error) {
      console.error(
        'Error cargando datos iniciales:',
        error
      )

      if (active) {
        setLeads([])
        setAlertas({
          vencidos: [],
          hoy: []
        })
        setUsuarios([])
      }
    }
  }

  cargarDatosIniciales()

  return () => {
    active = false
  }

}, [usuario])

    const leadsFiltrados = leads
  .filter((lead) => {

    const coincideBusqueda =
      (
        lead.nombre +
        lead.empresa +
        lead.telefono +
        lead.email
      )
        .toLowerCase()
        .includes(busqueda.toLowerCase())

    const coincideEstado =
      filtroEstado === 'todos'
        ? true
        : lead.estado === filtroEstado

    return coincideBusqueda && coincideEstado

  })
  .sort((a, b) => {

    if (orden === 'az') {
      return a.nombre.localeCompare(b.nombre)
    }

    if (orden === 'za') {
      return b.nombre.localeCompare(a.nombre)
    }

    if (orden === 'estado') {
      return a.estado.localeCompare(b.estado)
    }

    return 0

  })

const leadsVisibles =
  usuario?.rol === 'Ejecutivo'
    ? leadsFiltrados.filter(
        lead => lead.usuario_id === usuario.id
      )
    : leadsFiltrados
  
const alertasSeguras = {
  vencidos: Array.isArray(alertas?.vencidos)
    ? alertas.vencidos
    : [],
  hoy: Array.isArray(alertas?.hoy)
    ? alertas.hoy
    : []
}

const alertasVisibles =
  usuario?.rol === 'Ejecutivo'
    ? {
        vencidos: alertasSeguras.vencidos.filter(
          item => item.usuario_id === usuario.id
        ),
        hoy: alertasSeguras.hoy.filter(
          item => item.usuario_id === usuario.id
        )
      }
    : alertasSeguras


if (!usuario) {
  return (
    <Login onLogin={setUsuario} />
  )
}

const navigationClass = screen => (
  `block w-full rounded-lg px-3 py-2.5 text-left text-sm font-normal transition ${
    pantalla === screen
      ? 'bg-orange-500 text-white'
      : 'hover:bg-orange-500'
  }`
)

  return (
    <div className="crm-app min-h-screen bg-gray-100 flex">

      <aside className="w-56 min-h-screen shrink-0 bg-black text-white p-5 flex flex-col">

        <h1 className="mb-7 text-2xl font-bold leading-tight text-orange-500">
          Rosas y Asociados CRM
        </h1>

        <nav className="crm-navigation flex-1 space-y-2">
          
            {usuario?.rol !== 'Ejecutivo' && (
  <button
    onClick={() => setPantalla('usuarios')}
    className={navigationClass('usuarios')}
  >
    Usuarios
  </button>
)}
          <button
            onClick={() => setPantalla('dashboard')}
            className={navigationClass('dashboard')}
               >
           Dashboard
          </button>

          <button
            onClick={() => setPantalla('leads')}
                    className={navigationClass('leads')}
             >
           Leads
          </button>

          <button
            onClick={() => setPantalla('cartera')}
            className={navigationClass('cartera')}
          >
            Cartera
          </button>

          {usuario?.rol !== 'Ejecutivo' && (
            <button
              onClick={() => setPantalla('gestiones')}
              className={navigationClass('gestiones')}
            >
              Gestiones
            </button>
          )}

          {usuario?.rol !== 'Ejecutivo' && (
            <button
              onClick={() => setPantalla('tipificaciones')}
              className={navigationClass('tipificaciones')}
            >
              Tipificaciones
            </button>
          )}

          {usuario?.rol !== 'Ejecutivo' && (
            <button
              onClick={() => setPantalla('integraciones')}
              className={navigationClass('integraciones')}
            >
              Integraciones
            </button>
          )}

          {usuario?.rol !== 'Ejecutivo' && (
            <button
              onClick={() => setPantalla('banco-azteca')}
              className={navigationClass('banco-azteca')}
            >
              Banco Azteca
            </button>
          )}

          <button className="block w-full rounded-lg px-3 py-2.5 text-left text-sm font-normal transition hover:bg-orange-500">
            WhatsApp
          </button>

        </nav>

          <div className="mt-10 pt-4 border-t border-gray-700 text-xs text-gray-400">
            Tecnología desarrollada por
            <a
              href="https://we-tech.mx"
              target="_blank"
              rel="noreferrer"
              className="block mt-1 text-orange-400 hover:underline"
            >
              We-Tech.mx
            </a>
          </div>

      </aside>

      <main className="min-w-0 flex-1 p-6 lg:p-8">

{pantalla === 'usuarios' && (
  <Usuarios usuarioActual={usuario} />
)}

{pantalla === 'banco-azteca' && (
  <BancoAzteca />
)}

{pantalla === 'integraciones' && usuario?.rol !== 'Ejecutivo' && (
  <Integraciones />
)}

{pantalla === 'cartera' && (
  <Cartera usuario={usuario} />
)}

{pantalla === 'gestiones' && usuario?.rol !== 'Ejecutivo' && (
  <CarteraGestiones usuario={usuario} />
)}

{pantalla === 'tipificaciones' && usuario?.rol !== 'Ejecutivo' && (
  <CarteraTipificaciones />
)}

{(pantalla === 'dashboard' || pantalla === 'leads') && (
  <>

{pantalla === 'leads' && (
<div className="flex gap-2 mb-6">

  <button
    onClick={() => setVista('tabla')}
    className={`px-4 py-2 rounded ${
      vista === 'tabla'
        ? 'bg-orange-500 text-white'
        : 'bg-gray-200'
    }`}
  >
    ☰ Tabla
  </button>

  <button
    onClick={() => setVista('kanban')}
    className={`px-4 py-2 rounded ${
      vista === 'kanban'
        ? 'bg-orange-500 text-white'
        : 'bg-gray-200'
    }`}
  >
    🗂 Kanban
  </button>

  <button
    onClick={() => setVista('tarjetas')}
    className={`px-4 py-2 rounded ${
      vista === 'tarjetas'
        ? 'bg-orange-500 text-white'
        : 'bg-gray-200'
    }`}
  >
    📇 Tarjetas
  </button>

{usuario?.rol !== 'Ejecutivo' && (
  <label
    className="px-4 py-2 rounded bg-green-600 text-white cursor-pointer"
  >
    📥 Importar Leads

    <input
      type="file"
      accept=".xlsx,.xls"
      onChange={importarLeads}
      className="hidden"
    />
  </label>
)}

</div>
)}

        <div className="flex justify-between items-center mb-6">

  <div>

    <h1 className="text-5xl font-bold">
      {pantalla === 'dashboard'
        ? 'Dashboard'
        : 'Leads'}
    </h1>

    <p className="text-gray-500">
      Bienvenido {usuario?.nombre}
    </p>

  </div>

  <button
    onClick={() => {

      localStorage.removeItem('token')
      localStorage.removeItem('usuario')

      window.location.reload()

    }}
    className="bg-red-600 text-white px-4 py-2 rounded-lg"
  >
    Cerrar sesión
  </button>
</div>

{pantalla === 'leads' && (
<>
<input
  type="text"
  placeholder="🔍 Buscar lead..."
  value={busqueda}
  onChange={(e) => setBusqueda(e.target.value)}
  className="w-full mb-6 p-3 rounded-xl border"
/>

<div className="flex gap-4 mb-6">

  <select
    value={filtroEstado}
    onChange={(e) => setFiltroEstado(e.target.value)}
    className="border rounded p-2"
  >
    <option value="todos">Todos los estados</option>
    <option value="Nuevo">Nuevo</option>
    <option value="Contactado">Contactado</option>
    <option value="Seguimiento">Seguimiento</option>
    <option value="Propuesta enviada">Propuesta enviada</option>
    <option value="Ganado">Ganado</option>
    <option value="Perdido">Perdido</option>
  </select>

  <select
    value={orden}
    onChange={(e) => setOrden(e.target.value)}
    className="border rounded p-2"
  >
    <option value="estado">Estado</option>
    <option value="az">Nombre A-Z</option>
    <option value="za">Nombre Z-A</option>
  </select>

</div>
</>
)}

{pantalla === 'dashboard' && (
<>
{alertasVisibles.vencidos.length > 0 && (
  <div className="bg-red-100 border-l-4 border-red-500 p-4 mb-6 rounded">
    <h3 className="font-bold text-red-700">
      ⚠️ Seguimientos vencidos
    </h3>

    {alertasVisibles.vencidos.map(item => (
      <div key={item.id}>
        {item.nombre} - {
  new Date(item.proximo_contacto).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}
      </div>
    ))}
  </div>
)}

  <p className="mb-3 text-sm font-bold text-blue-600">
    RESUMEN DE LEADS
  </p>
  <div className="grid grid-cols-5 gap-4 mb-8">

  <div className="bg-blue-50 border-l-4 border-blue-500 rounded-2xl p-4 shadow">
  <h3 className="text-gray-600">Total Leads</h3>
  <p className="text-4xl font-normal text-blue-600">

    {totalLeads}

  </p>
 </div>

  <div className="bg-yellow-50 border-l-4 border-yellow-500 rounded-2xl p-4 shadow">
  <h3 className="text-gray-600">Nuevos</h3>
  <p className="text-4xl font-normal text-yellow-600">
    {nuevos}
  </p>
 </div>

  <div className="bg-orange-50 border-l-4 border-orange-500 rounded-2xl p-4 shadow">
  <h3 className="text-gray-600">Contactados</h3>
  <p className="text-4xl font-normal text-orange-600">
    {contactados}
  </p>
 </div>

  <div className="bg-green-50 border-l-4 border-green-500 rounded-2xl p-4 shadow">
  <h3 className="text-gray-600">Ganados</h3>
  <p className="text-4xl font-normal text-green-600">
    {ganados}
  </p>
 </div>

  <div className="bg-red-50 border-l-4 border-red-500 rounded-2xl p-4 shadow">
  <h3 className="text-gray-600">Perdidos</h3>
  <p className="text-4xl font-normal text-red-600">
    {perdidos}
  </p>

   
</div>
 
</div>

<CarteraDashboard />
</>
)}


{pantalla === 'leads' && (
<>
{vista === 'tabla' && (

        <div className="bg-white rounded-3xl p-8 shadow">
          <table className="w-full text-sm">


               <thead>
  <tr>
    <th>Nombre</th>
    <th>Empresa</th>
    <th>Teléfono</th>
    <th>Correo</th>
    <th>Prioridad</th>
    <th>Necesidad</th>
    <th>Asignado a</th>
    <th>Fecha</th>
    <th>Proxima Cita</th>
    <th>Notas</th>
    <th>Estado</th>
  </tr>
</thead>

<tbody>
  {leadsVisibles.map((lead) =>(
    <tr key={lead.id}>
    <td>

  <button
    onClick={() => setLeadSeleccionado(lead)}
    className="text-blue-600 hover:underline"
  >
    {lead.nombre}
  </button>

</td>
    <td>{lead.empresa}</td>

    <td>
<a
    href={`https://wa.me/52${lead.telefono}`}
    target="_blank"
    rel="noreferrer"
    className="text-green-600 font-normal hover:underline"
  >
    📱 {lead.telefono}
 
  </a>
</td>

<td>
  <a href={`mailto:${lead.email}`}>
    {lead.email}
  </a>
</td>

<td>{lead.prioridad}</td>

<td>{lead.necesidad}</td>

<td>
  <select
    value={lead.usuario_id || ''}
    onChange={(e) =>
      asignarLead(
        lead.id,
        Number(e.target.value)
      )
    }
    className="border rounded p-1 text-sm"
  >
    <option value="">
      Sin asignar
    </option>

    {usuarios.map((usuario) => (
      <option
        key={usuario.id}
        value={usuario.id}
      >
        {usuario.nombre}
      </option>
    ))}
  </select>
</td>

<td>
  {new Date(lead.created_at).toLocaleString("es-MX")}

</td>

<td>
  <input
  type="date"
  value={
  lead.proximo_contacto
    ? lead.proximo_contacto.split('T')[0]
    : ''
  }
  onChange={(e) =>
    actualizarFecha(lead.id, e.target.value)
  }
  className="border rounded p-1"
/>

</td>

<td>
  <textarea
  rows="2"
  defaultValue={lead.notas || ""}
  onBlur={(e) =>
    actualizarNotas(lead.id, e.target.value)
  }
  className="border rounded p-1 w-full text-sm"
/>
</td> 
<td>
<select
  value={lead.estado}
  onChange={(e) =>
    actualizarEstado(lead.id, e.target.value)
  }
  className="border rounded p-1 text-sm min-w-[140px]"
>
  <option>Nuevo</option>
  <option>Contactado</option>
  <option>Propuesta enviada</option>
  <option>Seguimiento</option>
  <option>Ganado</option>
  <option>Perdido</option>
</select>
</td>

</tr>
  ))}
</tbody>
          </table>
        </div>
 )}
{vista === 'tarjetas' && (

<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

  {leadsVisibles.map((lead) => (

    <div
      key={lead.id}
      className="bg-white rounded-2xl shadow p-4"
    >

      <h3
  onClick={() => setLeadSeleccionado(lead)}
  className="font-bold text-lg cursor-pointer text-blue-600"
>
  {lead.nombre}
</h3>

      <p>{lead.empresa}</p>

      <p className="text-green-600">
        📞 {lead.telefono}
      </p>

      <p className="text-blue-600">
        📧 {lead.email}
      </p>

      <p>
        Estado: {lead.estado}
      </p>

    </div>

  ))}

</div>

)}

{vista === 'kanban' && (

<LeadsKanban
  leads={leadsVisibles}
  onLeadClick={setLeadSeleccionado}
  onCambiarEstado={actualizarEstado}
/>

)}
</>
)}
        </>
)}  

<LeadDrawer
  lead={leadSeleccionado}
  onClose={() => setLeadSeleccionado(null)}
/>
     </main>

    </div>
  )
}
