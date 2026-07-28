const express = require('express')

const {
  verificaToken,
  requiereAdmin,
  requiereEmpresa
} = require('../middleware/auth')
const {
  configurationStatus,
  exportBankPortfolio
} = require('../controllers/banco-azteca.controller')

const router = express.Router()

router.use(
  verificaToken,
  requiereAdmin,
  requiereEmpresa
)

router.get('/estado', configurationStatus)
router.post('/exportar', exportBankPortfolio)

module.exports = router
