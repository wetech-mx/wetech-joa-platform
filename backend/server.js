require('dotenv').config()

const {
  verificaToken,
  requiereEmpresa,
  requiereAdmin,
  requiereSuperAdmin
} = require('./middleware/auth')

const authRoutes = require('./routes/auth.routes')
const usuariosRoutes = require('./routes/usuarios.routes')

const multer = require('multer')
const XLSX = require('xlsx')
const fs = require('fs')
const jwt = require('jsonwebtoken')

const { JWT_SECRET } = require('./config/auth')
const pool = require('./config/database')

const {
  ROLES,
  ESTADOS_LEAD,
  PRIORIDADES
} = require('./config/constants')


const express = require('express')
const cors = require('cors')
const bcrypt = require('bcrypt')

const app = express()

const upload = multer({
  dest: 'uploads/'
})

app.use(cors())
app.use(express.json())




async function registrarHistorial(
  lead_id,
  usuario_id,
  accion,
  detalle = ''
) {

  try {

    await pool.query(
      `
      INSERT INTO historial_leads
      (
        lead_id,
        usuario_id,
        accion,
        detalle
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4
      )
      `,
      [
        lead_id,
        usuario_id,
        accion,
        detalle
      ]
    )

  } catch(error) {

    console.error(
      'Error historial:',
      error
    )

  }

}

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'WE-TECH CRM API funcionando 🚀'
  })
})

app.use(
  '/api',
  authRoutes
)

app.use('/api', usuariosRoutes)

app.get(
  '/api/leads',
  verificaToken,
  async (req, res) => {

  try {

    let query = `
  SELECT
    leads.*,
    usuarios.nombre AS usuario_nombre
  FROM leads
  LEFT JOIN usuarios
    ON usuarios.id = leads.usuario_id
`

let params = []

if (
  req.usuario.rol !== 'super_admin'
) {

  query += `
    WHERE
      leads.empresa_id = $1
      AND leads.activo = true
  `

  params.push(
    req.usuario.empresa_id
  )

}
else {

  query += `
    WHERE leads.activo = true
  `

}

query += `
  ORDER BY leads.id DESC
`

const result =
  await pool.query(
    query,
    params
  )

    res.json(result.rows)

  } catch (error) {

    console.error(error)

    res.status(500).json({
      error: 'Error obteniendo leads'
    })

  }

})

app.get('/api/usuarios-activos', async (req, res) => {

  try {

    const result = await pool.query(`
      SELECT
        id,
        nombre
      FROM usuarios
      WHERE activo = true
      ORDER BY nombre
    `)

    res.json(result.rows)

  } catch(error){

    console.error(error)

    res.status(500).json({
      error: 'Error obteniendo usuarios activos'
    })

  }

})

console.log('*** ALERTAS CARGADAS ***')

app.get('/api/alertas', async (req, res) => {

  try {

    const vencidos = await pool.query(`
      SELECT *
      FROM leads
      WHERE proximo_contacto < CURRENT_DATE
      ORDER BY proximo_contacto ASC
    `)

    const hoy = await pool.query(`
      SELECT *
      FROM leads
      WHERE proximo_contacto = CURRENT_DATE
      ORDER BY proximo_contacto ASC
    `)

    res.json({
      vencidos: vencidos.rows,
      hoy: hoy.rows
    })

  } catch (error) {

    console.error(error)

    res.status(500).json({
      error: 'Error obteniendo alertas'
    })

  }

})

app.get('/api/leads/:id/historial', async (req, res) => {

  try {

    const { id } = req.params

    const result = await pool.query(
      `
      SELECT
        h.id,
        h.accion,
        h.detalle,
        h.created_at,
        u.nombre AS usuario
      FROM historial_leads h
      LEFT JOIN usuarios u
        ON h.usuario_id = u.id
      WHERE h.lead_id = $1
      ORDER BY h.created_at DESC
      `,
      [id]
    )

    res.json(result.rows)

  } catch(error) {

    console.error(error)

    res.status(500).json({
      error: 'Error obteniendo historial'
    })

  }

})

console.log('*** RUTA PUT USUARIOS CARGADA ***')

app.put('/api/usuarios/:id', async (req, res) => {

  const { id } = req.params

  const {
    nombre,
    email,
    rol
  } = req.body

  try {

    await pool.query(
      `
      UPDATE usuarios
      SET
        nombre = $1,
        email = $2,
        rol = $3
      WHERE id = $4
      `,
      [
        nombre,
        email,
        rol,
        id
      ]
    )

    res.json({
      success:true
    })

  } catch(error){

    console.error(error)

    res.status(500).json({
      error:'Error actualizando usuario'
    })

  }

})
app.put('/api/leads/:id/estado', async (req, res) => {

  try {

    const { id } = req.params
    const { estado } = req.body

    await pool.query(
      'UPDATE leads SET estado = $1 WHERE id = $2',
      [estado, id]
    )
await registrarHistorial(
  id,
  null,
  'Cambio de estado',
  `Estado cambiado a: ${estado}`
)

    res.json({
      success: true
    })

  } catch (error) {

    console.error(error)

    res.status(500).json({
      error: 'Error actualizando estado'
    })

  }

})

app.put('/api/leads/:id/asignar', async (req, res) => {
  try {
    const { usuario_id } = req.body;
    const { id } = req.params;

    await pool.query(
      `UPDATE leads
       SET usuario_id = $1
       WHERE id = $2`,
      [usuario_id, id]
    );
const usuario = await pool.query(
  `
  SELECT nombre
  FROM usuarios
  WHERE id = $1
  `,
  [usuario_id]
)

await registrarHistorial(
  id,
  usuario_id,
  'Asignación',
  `Asignado a: ${usuario.rows[0]?.nombre || 'Sin asignar'}`
)
    res.json({
      success: true
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false
    });
  }
});

app.put('/api/leads/:id/fecha', async (req, res) => {

  try {

    const { id } = req.params
    const { proximo_contacto } = req.body

    await pool.query(
      `
      UPDATE leads
      SET proximo_contacto = $1
      WHERE id = $2
      `,
      [proximo_contacto, id]
    )

await registrarHistorial(
  id,
  null,
  'Cambio de fecha',
  `Nueva fecha: ${proximo_contacto}`
)
    res.json({
      success: true
    })

  } catch (error) {

    console.error(error)

    res.status(500).json({
      error: 'Error actualizando fecha'
    })

  }

})
app.put('/api/leads/:id/notas', async (req, res) => {

  const { id } = req.params
  const { notas } = req.body

  try {

    await pool.query(
      `
      UPDATE leads
      SET notas = $1
      WHERE id = $2
      `,
      [notas, id]
    )

await registrarHistorial(
  id,
  null,
  'Nota actualizada',
  notas
)
    res.json({
      success: true
    })

  } catch (error) {

    console.error(error)

    res.status(500).json({
      error: 'Error actualizando notas'
    })
  }
})

app.get('/api/alertas', async (req, res) => {

  try {

    const vencidos = await pool.query(`
      SELECT *
      FROM leads
      WHERE proximo_contacto < CURRENT_DATE
      ORDER BY proximo_contacto ASC
    `)

    const hoy = await pool.query(`
      SELECT *
      FROM leads
      WHERE proximo_contacto = CURRENT_DATE
      ORDER BY proximo_contacto ASC
    `)

    res.json({
      vencidos: vencidos.rows,
      hoy: hoy.rows
    })

  } catch (error) {

    console.error(error)

    res.status(500).json({
      error: 'Error obteniendo alertas'
    })

  }

})

app.post('/api/usuarios', async (req, res) => {

  const {
    nombre,
    email,
    password,
    rol
  } = req.body

  try {

    const hash = await bcrypt.hash(password, 10)

    await pool.query(`
      INSERT INTO usuarios
      (
        nombre,
        email,
        password_hash,
        rol
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4
      )
    `,
    [
      nombre,
      email,
      hash,
      rol
    ])

    res.json({
      success: true
    })

  } catch(error){

    console.error(error)

    res.status(500).json({
      error: 'Error creando usuario'
    })

  }

})

console.log('*** RUTA DELETE USUARIOS CARGADA ***')

app.delete('/api/usuarios/:id', async (req, res) => {


console.log('DELETE EJECUTADO')

  const { id } = req.params

  try {

    await pool.query(
      'DELETE FROM usuarios WHERE id = $1',
      [id]
    )

    res.json({
      success: true
    })

  } catch(error){

    console.error(error)

    res.status(500).json({
      error: 'Error eliminando usuario'
    })

  }

})
console.log('ULTIMA LINEA ANTES DEL LISTEN')

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:')
  console.error(err)
})

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:')
  console.error(err)
})

app.post(
  '/api/importar-leads',
  upload.single('archivo'),
  async (req, res) => {

    try {

if (!req.file) {
  return res.status(400).json({
    error: 'No se recibió archivo'
  })
}

      const workbook = XLSX.readFile(
        req.file.path
      )

      const hoja =
        workbook.Sheets[
          workbook.SheetNames[0]
        ]

      const filas =
        XLSX.utils.sheet_to_json(hoja)

if (!filas.length) {
  return res.status(400).json({
    error: 'El archivo está vacío'
  })
}

const columnas = Object.keys(filas[0])

if (
  !columnas.includes('nombre')
) {
  return res.status(400).json({
    error: 'Falta columna nombre'
  })
}

      let importados = 0
let duplicados = 0
let omitidos = 0

const filasValidas =
  filas.filter(fila =>
    fila.nombre
  )

for (const fila of filasValidas) {

  let existe

  if (fila.email && fila.telefono) {

    existe = await pool.query(
      `
      SELECT id
      FROM leads
      WHERE
        LOWER(TRIM(email)) =
        LOWER(TRIM($1))
        AND telefono = $2
      `,
      [
        fila.email,
        fila.telefono
      ]
    )

  } else {

    omitidos++

    continue

  }

  if (existe.rows.length > 0) {

    duplicados++

    continue

  }

  await pool.query(`
    INSERT INTO leads (
      nombre,
      empresa,
      telefono,
      email,
      prioridad,
      necesidad,
      estado
    )

          VALUES (
            $1,$2,$3,$4,$5,$6,$7
          )
        `,[
          fila.nombre || '',
          fila.empresa || '',
          fila.telefono || '',
          fila.email || '',
          fila.prioridad || 'Media',
          fila.necesidad || '',
          fila.estado || 'Nuevo'
        ])

        importados++

      }

      fs.unlinkSync(req.file.path)

      res.json({
        success: true,
        importados,
         duplicados,
        omitidos
      })

    } catch(error) {

      console.error(error)

      res.status(500).json({
        error: 'Error importando Excel'
      })

    }

})


const PORT = 3001


app.listen(PORT, () => {
  console.log(`Servidor CRM activo en puerto ${PORT}`)
})
