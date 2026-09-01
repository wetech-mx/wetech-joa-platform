require('dotenv').config()

const express = require('express')
const cors = require('cors')

const authRoutes = require('./routes/auth.routes')
const usuariosRoutes = require('./routes/usuarios.routes')
const bancoAztecaRoutes = require('./routes/banco-azteca.routes')
const carteraRoutes = require('./routes/cartera.routes')
const leadsRoutes = require('./routes/leads.routes')
const integrationsRoutes = require('./routes/integrations.routes')
const {
  crearOpcionesCors
} = require('./config/security')

const app = express()

app.disable('x-powered-by')
app.set('trust proxy', 'loopback')
app.use(cors(crearOpcionesCors(process.env.CORS_ORIGINS)))
app.use(express.json({ limit: '1mb' }))

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Rosas y Asociados CRM API funcionando'
  })
})

app.use('/api', authRoutes)
app.use('/api', usuariosRoutes)
app.use('/api', leadsRoutes)
app.use('/api', integrationsRoutes)
app.use('/api/banco-azteca', bancoAztecaRoutes)
app.use('/api', carteraRoutes)

process.on('uncaughtException', error => {
  console.error('UNCAUGHT EXCEPTION:', error)
})

process.on('unhandledRejection', error => {
  console.error('UNHANDLED REJECTION:', error)
})

const PORT = 3001

app.listen(PORT, () => {
  console.log(`Servidor CRM activo en puerto ${PORT}`)
})
