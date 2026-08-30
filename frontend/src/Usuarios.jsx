import { useEffect, useState } from 'react'
import { apiFetch } from './api'

export default function Usuarios({ usuarioActual }) {

const [mostrarModal, setMostrarModal] = useState(false)

const [modoEdicion, setModoEdicion] = useState(false)

const [usuarioEditando, setUsuarioEditando] = useState(null)

const [usuarioPassword, setUsuarioPassword] = useState(null)

const [passwordNueva, setPasswordNueva] = useState('')

const [passwordConfirmacion, setPasswordConfirmacion] = useState('')

const [passwordError, setPasswordError] = useState('')

const [restableciendoPassword, setRestableciendoPassword] =
  useState(false)

const [nuevoUsuario, setNuevoUsuario] = useState({
  nombre: '',
  email: '',
  password: '',
  rol: 'Ejecutivo'
})
  const [usuarios, setUsuarios] = useState([])
const [errorCarga, setErrorCarga] = useState('')

const abrirNuevoUsuario = () => {
  setModoEdicion(false)
  setUsuarioEditando(null)
  setNuevoUsuario({
    nombre: '',
    email: '',
    password: '',
    rol: 'Ejecutivo'
  })
  setMostrarModal(true)
}

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

const abrirRestablecerPassword = (usuario) => {
  setUsuarioPassword(usuario)
  setPasswordNueva('')
  setPasswordConfirmacion('')
  setPasswordError('')
}

const cerrarRestablecerPassword = () => {
  if (restableciendoPassword) return

  setUsuarioPassword(null)
  setPasswordNueva('')
  setPasswordConfirmacion('')
  setPasswordError('')
}

const restablecerPassword = async () => {
  if (passwordNueva.length < 10 || passwordNueva.length > 128) {
    setPasswordError(
      'La contraseña debe tener entre 10 y 128 caracteres.'
    )
    return
  }

  if (passwordNueva !== passwordConfirmacion) {
    setPasswordError('Las contraseñas no coinciden.')
    return
  }

  setRestableciendoPassword(true)
  setPasswordError('')

  try {
    const response = await apiFetch(
      `/crm-api/usuarios/${usuarioPassword.id}/password`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          password: passwordNueva
        })
      }
    )
    const data = await response.json()

    if (!response.ok) {
      throw new Error(
        data.error || 'No fue posible restablecer la contraseña'
      )
    }

    alert(`Contraseña restablecida para ${usuarioPassword.nombre}`)
    setUsuarioPassword(null)
    setPasswordNueva('')
    setPasswordConfirmacion('')
  } catch (error) {
    console.error(error)
    setPasswordError(error.message)
  } finally {
    setRestableciendoPassword(false)
  }
}

const eliminarUsuario = async (id) => {

  if (id === usuarioActual?.id) {
    alert('No puedes desactivar tu propia cuenta')
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
  onClick={abrirNuevoUsuario}
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
  disabled={usuario.rol === 'super_admin'}
  className="
    bg-yellow-500
    hover:bg-yellow-600
    text-white
    px-3
    py-1
    rounded-lg
    transition disabled:opacity-40 disabled:cursor-not-allowed
  "
>
  ✏️ Editar
</button>

<button
  onClick={() => abrirRestablecerPassword(usuario)}
  disabled={
    !usuario.activo
    || usuario.rol === 'super_admin'
  }
  className="ml-2 rounded-lg bg-blue-700 px-3 py-2 text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
>
  🔑 Contraseña
</button>

<button
  onClick={() => eliminarUsuario(usuario.id)}
  disabled={
    usuario.rol === 'super_admin'
    || usuario.id === usuarioActual?.id
  }
  className="
    bg-red-600
    hover:bg-red-700
    text-white
    px-3
    py-2
    rounded-lg
    transition
    ml-2 disabled:opacity-40 disabled:cursor-not-allowed
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

{!modoEdicion && (
  <input
    type="password"
    minLength="10"
    maxLength="128"
    placeholder="Contraseña (mínimo 10 caracteres)"
    className="w-full border p-3 mb-3 rounded"
    onChange={(e)=>
      setNuevoUsuario({
        ...nuevoUsuario,
        password:e.target.value
      })
    }
  />
)}

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

{usuarioPassword && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl">
      <h2 className="text-2xl font-bold">
        Restablecer contraseña
      </h2>

      <p className="mt-2 text-sm text-gray-600">
        Usuario: <strong>{usuarioPassword.nombre}</strong>
      </p>

      <p className="mt-1 text-sm text-gray-600">
        La contraseña anterior no se mostrará ni será necesaria.
      </p>

      {passwordError && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          {passwordError}
        </div>
      )}

      <label className="mt-5 block text-sm font-bold">
        Nueva contraseña
        <input
          type="password"
          minLength="10"
          maxLength="128"
          autoComplete="new-password"
          value={passwordNueva}
          onChange={event => setPasswordNueva(event.target.value)}
          className="mt-1 w-full rounded-xl border p-3 font-normal"
          placeholder="Entre 10 y 128 caracteres"
        />
      </label>

      <label className="mt-4 block text-sm font-bold">
        Confirmar contraseña
        <input
          type="password"
          minLength="10"
          maxLength="128"
          autoComplete="new-password"
          value={passwordConfirmacion}
          onChange={event =>
            setPasswordConfirmacion(event.target.value)
          }
          className="mt-1 w-full rounded-xl border p-3 font-normal"
          placeholder="Repita la nueva contraseña"
        />
      </label>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={restablecerPassword}
          disabled={restableciendoPassword}
          className="rounded-xl bg-blue-700 px-5 py-3 text-white hover:bg-blue-800 disabled:bg-gray-300"
        >
          {restableciendoPassword
            ? 'Restableciendo…'
            : 'Guardar nueva contraseña'}
        </button>

        <button
          type="button"
          onClick={cerrarRestablecerPassword}
          disabled={restableciendoPassword}
          className="rounded-xl bg-gray-400 px-5 py-3 text-white hover:bg-gray-500 disabled:bg-gray-300"
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
