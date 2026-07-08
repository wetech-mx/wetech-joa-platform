const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'Administrador',
  EJECUTIVO: 'Ejecutivo'
})

const ESTADOS_LEAD = Object.freeze({
  NUEVO: 'Nuevo',
  CONTACTADO: 'Contactado',
  SEGUIMIENTO: 'Seguimiento',
  GANADO: 'Ganado',
  PERDIDO: 'Perdido'
})

const PRIORIDADES = Object.freeze({
  BAJA: 'Baja',
  MEDIA: 'Media',
  ALTA: 'Alta'
})

module.exports = {
  ROLES,
  ESTADOS_LEAD,
  PRIORIDADES
}

