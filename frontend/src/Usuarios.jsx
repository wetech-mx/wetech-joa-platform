import { useEffect, useState } from 'react'
import { apiFetch } from './api'

export default function Usuarios() {

const [mostrarModal, setMostrarModal] = useState(false)

const [modoEdicion, setModoEdicion] = useState(false)

const [usuarioEditando, setUsuarioEditando] = useState(null)

const [nuevoUsuario, setNuevoUsuario] = useState({
  nombre: '',
  email: '',
  password: '',
  rol: 'Ejecutivo'
})
  const [usuarios, setUsuarios] = useState([])
  const [errorCarga, setErrorCarga] = useState('')

  const obtenerUsuarios = async () => {

    try {

      setErrorCarga('')

      const res = await apiFetch('/crm-api/usuarios')
      const data = await res.json()

      if (!res.ok) {
        throw new Error(
          data.error || 'No fue posible consultar los usuarios'
        )
      }

      if (!Array.isArray(data)) {
        throw new Error(
          'La respuesta de usuarios no tiene el formato esperado'
        )
      }

      setUsuarios(data)

    } catch (error) {

      console.error(error)
      setUsuarios([])
      setErrorCarga(error.message)

    }

  }

  useEffect(() => {

  // La carga inicial actualiza el estado con la respuesta de la API.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  obtenerUsuarios()

}, [])

const guardarUsuario = async () => {

  try {

    if(modoEdicion){

      const response = await apiFetch(
        `/crm-api/usuarios/${usuarioEditando.id}`,
        {
          method:'PUT',
          headers:{
            'Content-Type':'application/json'
          },
          body: JSON.stringify({
            nombre:nuevoUsuario.nombre,
            email:nuevoUsuario.email,
            rol:nuevoUsuario.rol
          })
        }
      )

      const data = await response.json()

      if(response.ok){

        alert('Usuario actualizado')

        setMostrarModal(false)

        obtenerUsuarios()

        return
      }

      alert(JSON.stringify(data))

      return
    }

    const response = await apiFetch(
      '/crm-api/usuarios',
      {
        method:'POST',
        headers:{
          'Content-Type':'application/json'
        },
        body: JSON.stringify(nuevoUsuario)
      }
    )

    const data = await response.json()

    if(response.ok){

      alert('Usuario creado')

      setMostrarModal(false)

      obtenerUsuarios()

    } else {

      alert(JSON.stringify(data))

    }

  } catch(error){

    console.error(error)

    alert('Error de conexión')

  }

}

const editarUsuario = (usuario) => {

  console.log('EDITANDO:', usuario)

  setModoEdicion(true)

  setUsuarioEditando(usuario)

  setNuevoUsuario({
    nombre: usuario.nombre,
    email: usuario.email,
    password: '',
    rol: usuario.rol
  })

  setMostrarModal(true)

}

const eliminarUsuario = async (id) => {

if(id === 1){
    alert('No puedes eliminar el administrador principal')
    return
  }

  const confirmar = confirm(
    '¿Deseas eliminar este usuario?'
  )

  if(!confirmar) return

  try {

    const response = await apiFetch(
      `/crm-api/usuarios/${id}`,
      {
        method:'DELETE'
      }
    )

    const data = await response.json()

    if(response.ok){

      alert('Usuario eliminado')

      obtenerUsuarios()

    } else {

      alert(JSON.stringify(data))

    }

  } catch(error){

    console.error(error)

    alert('Error eliminando usuario')

  }

}

  return (

    <div className="bg-white rounded-3xl shadow p-6">

      <div className="flex justify-between mb-6">

        <h2 className="text-2xl font-bold">
          Usuarios
        </h2>

        <button
  onClick={() => setMostrarModal(true)}
  className="
    bg-blue-600
    hover:bg-blue-700
    text-white
    px-6
    py-3
    rounded-xl
    transition
  "
>
  + Nuevo Usuario
</button>

      </div>

      {errorCarga && (
          <div className="mb-6 rounded-xl border border-red-300 bg-red-50 p-4 text-red-700">
            {errorCarga}
          </div>
        )}


      <table className="w-full">

        <thead>

          <tr>

            <th className="text-left">Nombre</th>
            <th className="text-left">Email</th>
            <th className="text-left">Rol</th>
            <th className="text-left">Activo</th>
            <th>Acciones</th>

          </tr>

        </thead>

        <tbody>

          {usuarios.map(usuario => (

            <tr key={usuario.id}>

              <td>{usuario.nombre}</td>

              <td>{usuario.email}</td>

              <td>{usuario.rol}</td>

              <td>
                {usuario.activo ? '✅' : '❌'}
              </td>
<td>

<button
  onClick={() => editarUsuario(usuario)}
  className="
    bg-yellow-500
    hover:bg-yellow-600
    text-white
    px-3
    py-1
    rounded-lg
    transition
  "
>
  ✏️ Editar
</button>

<button
  onClick={() => eliminarUsuario(usuario.id)}
  className="
    bg-red-600
    hover:bg-red-700
    text-white
    px-3
    py-2
    rounded-lg
    transition
    ml-2
  "
>
  🗑 Eliminar
</button>

</td>            
  
            </tr>

          ))}

        </tbody>

      </table>

{mostrarModal && (

<div className="
fixed
inset-0
bg-black/50
flex
items-center
justify-center
z-50
">

<div className="
bg-white
rounded-3xl
shadow-2xl
p-8
animate-fadeIn
">

<h2 className="text-2xl font-bold mb-6">

{modoEdicion
  ? 'Editar Usuario'
  : 'Nuevo Usuario'
}

</h2>

<input
  placeholder="Nombre"
  value={nuevoUsuario.nombre}
  className="w-full border p-3 mb-3 rounded"
  onChange={(e)=>
    setNuevoUsuario({
      ...nuevoUsuario,
      nombre:e.target.value
    })
  }
/>

<input
  placeholder="Email"
  value={nuevoUsuario.email}
  className="w-full border p-3 mb-3 rounded"
  onChange={(e)=>
    setNuevoUsuario({
      ...nuevoUsuario,
      email:e.target.value
    })
  }
/>

<input
  type="password"
  placeholder="Contraseña"
  className="w-full border p-3 mb-3 rounded"
  onChange={(e)=>
    setNuevoUsuario({
      ...nuevoUsuario,
      password:e.target.value
    })
  }
/>

<select
  className="w-full border p-3 mb-6 rounded"
    value={nuevoUsuario.rol}
    onChange={(e)=>
    setNuevoUsuario({
      ...nuevoUsuario,
      rol:e.target.value
    })
  }
>

<option>Administrador</option>
<option>Supervisor</option>
<option>Ejecutivo</option>

</select>

<div className="flex gap-4">

<button
  onClick={guardarUsuario}
  className="
bg-green-600
hover:bg-green-700
hover:scale-105
text-white
px-6
py-3
rounded-xl
transition
duration-200
cursor-pointer
shadow
"
>
Guardar
</button>

<button
  onClick={() => setMostrarModal(false)}
  className="
bg-gray-400
hover:bg-gray-500
hover:scale-105
text-white
px-6
py-3
rounded-xl
transition
duration-200
cursor-pointer
shadow
"
>
Cancelar
</button>

</div>

</div>

</div>

)}
    </div>

  )

}
