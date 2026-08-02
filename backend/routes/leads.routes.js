'use strict'

const express = require('express')
const multer = require('multer')

const {
  asignar,
  cambiarEstado,
  cambiarFecha,
  cambiarNotas,
  importar,
  obtenerAlertas,
  obtenerEjecutivosActivos,
  obtenerHistorial,
  obtenerLeads
} = require('../controllers/leads.controller')
const {
  verificaToken,
  requiereAdmin,
  requiereEmpresa
} = require('../middleware/auth')

const router = express.Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: 10 * 1024 * 1024
  }
})

function receiveLeadFile(req, res, next) {
  upload.single('archivo')(req, res, error => {
    if (!error) {
      return next()
    }

    if (error instanceof multer.MulterError) {
      return res.status(400).json({
        error: 'El archivo no cumple los límites permitidos',
        code: 'LEAD_IMPORT_FILE_INVALID'
      })
    }

    return res.status(400).json({
      error: 'No fue posible recibir el archivo',
      code: 'LEAD_IMPORT_FILE_INVALID'
    })
  })
}

router.use(verificaToken, requiereEmpresa)

router.get('/leads', obtenerLeads)
router.get('/usuarios-activos', obtenerEjecutivosActivos)
router.get('/alertas', obtenerAlertas)
router.get('/leads/:id/historial', obtenerHistorial)

router.put('/leads/:id/estado', cambiarEstado)
router.put('/leads/:id/fecha', cambiarFecha)
router.put('/leads/:id/notas', cambiarNotas)
router.put('/leads/:id/asignar', requiereAdmin, asignar)

router.post(
  '/importar-leads',
  requiereAdmin,
  receiveLeadFile,
  importar
)

module.exports = router
