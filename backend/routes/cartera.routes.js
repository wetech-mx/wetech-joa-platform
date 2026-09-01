const express = require('express')
const path = require('node:path')
const multer = require('multer')

const {
  actualizarCampaniaCartera,
  actualizarEstadoCartera,
  actualizarTipificacionCartera,
  agregarNotaCartera,
  confirmarImportacionCartera,
  crearTipificacionCartera,
  descargarReporteCorteCartera,
  obtenerAlertasCartera,
  obtenerCampaniasCartera,
  obtenerCartera,
  obtenerCortesCartera,
  obtenerCuentaCartera,
  obtenerEjecutivosCartera,
  obtenerEstadoImportacionCartera,
  obtenerGestionesCartera,
  obtenerOrigenesCartera,
  obtenerResumenCartera,
  obtenerReporteCorteCartera,
  obtenerTipificacionesCartera,
  obtenerTipificacionesAdministracion,
  previsualizarImportacionCartera,
  reasignarCuentaCartera,
  registrarGestionCartera,
  resolverValidacionPagoCartera
} = require('../controllers/cartera.controller')

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
    fileSize: 25 * 1024 * 1024
  },
  fileFilter(req, file, callback) {
    const extension = path.extname(
      file.originalname || ''
    ).toLowerCase()

    callback(
      extension === '.xlsx'
        ? null
        : new Error('CARTERA_IMPORT_EXTENSION_INVALID'),
      extension === '.xlsx'
    )
  }
})

function receivePortfolioFile(req, res, next) {
  upload.single('archivo')(req, res, error => {
    if (!error && req.file?.buffer) {
      return next()
    }

    const tooLarge = (
      error instanceof multer.MulterError
      && error.code === 'LIMIT_FILE_SIZE'
    )

    return res.status(400).json({
      error: tooLarge
        ? 'El archivo supera el límite de 25 MB'
        : 'Seleccione un archivo Excel .xlsx válido',
      code: tooLarge
        ? 'CARTERA_IMPORT_FILE_TOO_LARGE'
        : 'CARTERA_IMPORT_FILE_INVALID'
    })
  })
}

router.use(
  verificaToken,
  requiereEmpresa
)

router.get(
  '/cartera',
  obtenerCartera
)

router.get(
  '/cartera/ejecutivos',
  obtenerEjecutivosCartera
)

router.get(
  '/cartera/origenes',
  obtenerOrigenesCartera
)

router.get(
  '/cartera/resumen',
  obtenerResumenCartera
)

router.get(
  '/cartera/alertas',
  obtenerAlertasCartera
)

router.get(
  '/cartera/gestiones',
  obtenerGestionesCartera
)

router.get(
  '/cartera/campanias',
  requiereAdmin,
  obtenerCampaniasCartera
)

router.patch(
  '/cartera/campanias/:id',
  requiereAdmin,
  actualizarCampaniaCartera
)

router.get(
  '/cartera/reportes/cortes',
  obtenerCortesCartera
)

router.get(
  '/cartera/reportes/corte',
  obtenerReporteCorteCartera
)

router.get(
  '/cartera/reportes/corte.xlsx',
  descargarReporteCorteCartera
)

router.get(
  '/cartera/tipificaciones',
  obtenerTipificacionesCartera
)

router.post(
  '/cartera/importaciones/preview',
  requiereAdmin,
  receivePortfolioFile,
  previsualizarImportacionCartera
)

router.post(
  '/cartera/importaciones/confirm',
  requiereAdmin,
  receivePortfolioFile,
  confirmarImportacionCartera
)

router.get(
  '/cartera/importaciones/trabajos/:jobId',
  requiereAdmin,
  obtenerEstadoImportacionCartera
)

router.get(
  '/cartera/tipificaciones/administracion',
  requiereAdmin,
  obtenerTipificacionesAdministracion
)

router.post(
  '/cartera/tipificaciones',
  requiereAdmin,
  crearTipificacionCartera
)

router.patch(
  '/cartera/tipificaciones/:id',
  requiereAdmin,
  actualizarTipificacionCartera
)

router.post(
  '/cartera/:id/gestiones',
  registrarGestionCartera
)

router.post(
  '/cartera/:id/notas',
  agregarNotaCartera
)

router.patch(
  '/cartera/pagos/:id/validacion',
  requiereAdmin,
  resolverValidacionPagoCartera
)

router.patch(
  '/cartera/:id/estado',
  requiereAdmin,
  actualizarEstadoCartera
)

router.post(
  '/cartera/:id/reasignar',
  requiereAdmin,
  reasignarCuentaCartera
)

router.get(
  '/cartera/:id',
  obtenerCuentaCartera
)

module.exports = router
