const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const { JWT_SECRET } = require('../config/auth')
const pool = require('../config/database')

async function login(req, res) {

  const { email, password } = req.body

  try {

    const result = await pool.query(
      'SELECT * FROM usuarios WHERE email = $1',
      [email]
    )

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'Usuario no encontrado'
      })
    }

    const usuario = result.rows[0]

    const valido = await bcrypt.compare(
      password,
      usuario.password_hash
    )

    if (!valido) {
      return res.status(401).json({
        error: 'Contraseña incorrecta'
      })
    }

    const token = jwt.sign(
      {
        id: usuario.id,
        rol: usuario.rol,
        empresa_id: usuario.empresa_id
      },
      JWT_SECRET,
      {
        expiresIn: '12h'
      }
    )

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
  login
}
