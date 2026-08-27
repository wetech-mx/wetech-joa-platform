const ROLES = Object.freeze({
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'Administrador',
  EJECUTIVO: 'Ejecutivo'
})

const ESTADOS_LEAD = Object.freeze({
  NUEVO: 'Nuevo',
  CONTACTADO: 'Contactado',
  SEGUIMIENTO: 'Seguimiento',
  PROPUESTA_ENVIADA: 'Propuesta enviada',
  GANADO: 'Ganado',
  PERDIDO: 'Perdido'
})

const PRIORIDADES = Object.freeze({
  BAJA: 'Baja',
  MEDIA: 'Media',
  ALTA: 'Alta'
})

const CARTERA_ESTADOS = Object.freeze({
  SIN_GESTIONAR: 'sin_gestionar',
  CONTACTADO: 'contactado',
  NO_LOCALIZADO: 'no_localizado',
  SEGUIMIENTO: 'seguimiento',
  PROMESA_PAGO: 'promesa_pago',
  PROMESA_INCUMPLIDA: 'promesa_incumplida',
  CONVENIO: 'convenio',
  PAGO_REPORTADO: 'pago_reportado',
  PAGO_REALIZADO: 'pago_realizado',
  RECHAZO_PAGO: 'rechazo_pago',
  DATOS_INCORRECTOS: 'datos_incorrectos',
  CERRADO: 'cerrado'
})

module.exports = {
  ROLES,
  ESTADOS_LEAD,
  PRIORIDADES,
  CARTERA_ESTADOS
}
