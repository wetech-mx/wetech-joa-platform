const bcrypt = require('bcrypt')
const crypto = require('node:crypto')
const jwt = require('jsonwebtoken')

const { JWT_SECRET } = require('../config/auth')
const pool = require('../config/database')
const {
  createSession
} = require('../repositories/session-control-repository')

const SESSION_DURATION_HOURS = 12

function requestIp(req) {
  return req.ip || req.socket?.remoteAddress || null
}

async function login(req, res) {

  const { email, password } = req.body

  if (
    typeof email !== 'string'
    || typeof password !== 'string'
    || !email.trim()
    || !password
  ) {
    return res.status(400).json({
      error: 'Correo y contraseña son obligatorios'
    })
  }

  try {

    const result = await pool.query(
      `
      SELECT *
      FROM public.usuarios
      WHERE
        LOWER(email) = LOWER($1)
        AND activo = TRUE
      `,
      [email.trim()]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'Credenciales inválidas'
      })
    }

    const usuario = result.rows[0]

    const valido = await bcrypt.compare(
      password,
      usuario.password_hash
    )

    if (!valido) {
      return res.status(401).json({
        error: 'Credenciales inválidas'
      })
    }

    const sessionId = crypto.randomUUID()
    const expiresAt = new Date(
      Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000
    )

    const token = jwt.sign(
      {
        id: usuario.id,
        rol: usuario.rol,
        empresa_id: usuario.empresa_id
      },
      JWT_SECRET,
      {
        expiresIn: `${SESSION_DURATION_HOURS}h`,
        jwtid: sessionId
      }
    )

    await createSession({
      pool,
      usuario,
      sessionId,
      expiresAt,
      ipAddress: requestIp(req),
      userAgent: req.get('user-agent')
    })

    res.json({
      token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        rol: usuario.rol,
        empresa_id: usuario.empresa_id
      }
    })

  } catch (error) {

    console.error(error)

    res.status(500).json({
      error: 'Error login'
    })

  }

}

module.exports = {
  SESSION_DURATION_HOURS,
  login
}
