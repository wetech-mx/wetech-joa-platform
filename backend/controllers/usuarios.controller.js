const pool = require('../config/database')

async function obtenerUsuarios(req, res) {

  try {

    const result = await pool.query(`
      SELECT
        id,
        nombre,
        email,
        rol
      FROM usuarios
      ORDER BY id
    `)

    res.json(result.rows)

  } catch (error) {

    console.error(error)

    res.status(500).json({
      error: 'Error obteniendo usuarios'
    })

  }

}

async function crearUsuario(req, res) {

}

async function editarUsuario(req, res) {

}

async function eliminarUsuario(req, res) {

}

module.exports = {
  obtenerUsuarios,
  crearUsuario,
  editarUsuario,
  eliminarUsuario
}
