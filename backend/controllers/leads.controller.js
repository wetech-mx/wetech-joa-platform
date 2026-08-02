'use strict'

const XLSX = require('xlsx')

const pool = require('../config/database')
const {
  LeadSecurityError,
  assignLead,
  getLeadHistory,
  importLeadRows,
  listActiveExecutives,
  listAlerts,
  listLeads,
  updateLeadDate,
  updateLeadNotes,
  updateLeadState
} = require('../repositories/leads-repository')

function sendLeadError(res, error) {
  if (error instanceof LeadSecurityError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code
    })
  }

  console.error('LEADS_API_ERROR:', error)

  return res.status(500).json({
    error: 'Error interno procesando leads'
  })
}

async function obtenerLeads(req, res) {
  try {
    res.json(await listLeads({
      pool,
      usuario: req.usuario
    }))
  } catch (error) {
    sendLeadError(res, error)
  }
}

async function obtenerEjecutivosActivos(req, res) {
  try {
    res.json(await listActiveExecutives({
      pool,
      usuario: req.usuario
    }))
  } catch (error) {
    sendLeadError(res, error)
  }
}

async function obtenerAlertas(req, res) {
  try {
    res.json(await listAlerts({
      pool,
      usuario: req.usuario
    }))
  } catch (error) {
    sendLeadError(res, error)
  }
}

async function obtenerHistorial(req, res) {
  try {
    res.json(await getLeadHistory({
      pool,
      usuario: req.usuario,
      leadId: req.params.id
    }))
  } catch (error) {
    sendLeadError(res, error)
  }
}

async function cambiarEstado(req, res) {
  try {
    res.json(await updateLeadState({
      pool,
      usuario: req.usuario,
      leadId: req.params.id,
      estado: req.body.estado
    }))
  } catch (error) {
    sendLeadError(res, error)
  }
}

async function cambiarFecha(req, res) {
  try {
    res.json(await updateLeadDate({
      pool,
      usuario: req.usuario,
      leadId: req.params.id,
      proximoContacto: req.body.proximo_contacto
    }))
  } catch (error) {
    sendLeadError(res, error)
  }
}

async function cambiarNotas(req, res) {
  try {
    res.json(await updateLeadNotes({
      pool,
      usuario: req.usuario,
      leadId: req.params.id,
      notas: req.body.notas
    }))
  } catch (error) {
    sendLeadError(res, error)
  }
}

async function asignar(req, res) {
  try {
    res.json(await assignLead({
      pool,
      usuario: req.usuario,
      leadId: req.params.id,
      usuarioId: req.body.usuario_id
    }))
  } catch (error) {
    sendLeadError(res, error)
  }
}

async function importar(req, res) {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({
        error: 'No se recibió archivo',
        code: 'LEAD_IMPORT_FILE_REQUIRED'
      })
    }

    const workbook = XLSX.read(req.file.buffer, {
      type: 'buffer'
    })
    const firstSheet = workbook.SheetNames[0]

    if (!firstSheet) {
      return res.status(400).json({
        error: 'El archivo está vacío',
        code: 'LEAD_IMPORT_EMPTY'
      })
    }

    const rows = XLSX.utils.sheet_to_json(
      workbook.Sheets[firstSheet],
      {
        defval: ''
      }
    )

    res.json(await importLeadRows({
      pool,
      usuario: req.usuario,
      rows
    }))
  } catch (error) {
    sendLeadError(res, error)
  }
}

module.exports = {
  asignar,
  cambiarEstado,
  cambiarFecha,
  cambiarNotas,
  importar,
  obtenerAlertas,
  obtenerEjecutivosActivos,
  obtenerHistorial,
  obtenerLeads,
  sendLeadError
}
