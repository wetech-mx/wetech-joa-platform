import { useState } from 'react'

export default function Login({ onLogin }) {

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const iniciarSesion = async (e) => {

    e.preventDefault()

    try {

      const response = await fetch('/crm-api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email,
          password
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error)
      }

      localStorage.setItem('token', data.token)
      localStorage.setItem(
        'usuario',
        JSON.stringify(data.usuario)
      )

      onLogin(data.usuario)

    } catch (error) {

      setError(error.message)

    }

  }

  return (
    <div className="crm-login min-h-screen flex items-center justify-center bg-gray-100">

      <form
        onSubmit={iniciarSesion}
        className="bg-white p-8 rounded-xl shadow-md w-96"
      >

        <h1 className="text-2xl font-bold mb-6 text-center">
          Rosas y Asociados CRM
        </h1>

        <input
          type="email"
          placeholder="Correo"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border p-2 mb-4 rounded"
        />

        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border p-2 mb-4 rounded"
        />

        {error && (
          <p className="text-red-600 mb-4">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="w-full bg-red-600 text-white p-2 rounded"
        >
          Ingresar
        </button>

          <p className="mt-6 text-center text-xs text-gray-500">
            Tecnología desarrollada por{' '}
            <a
              href="https://we-tech.mx"
              target="_blank"
              rel="noreferrer"
              className="font-normal hover:underline"
            >
              We-Tech.mx
            </a>
          </p>

      </form>

    </div>
  )

}
