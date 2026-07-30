export const CARTERA_ESTADOS = [
  {
    value: 'sin_gestionar',
    label: 'Sin gestionar'
  },
  {
    value: 'contactado',
    label: 'Contactado'
  },
  {
    value: 'no_localizado',
    label: 'No localizado'
  },
  {
    value: 'seguimiento',
    label: 'Seguimiento'
  },
  {
    value: 'promesa_pago',
    label: 'Promesa de pago'
  },
  {
    value: 'promesa_incumplida',
    label: 'Promesa incumplida'
  },
  {
    value: 'convenio',
    label: 'Convenio'
  },
  {
    value: 'pago_realizado',
    label: 'Pago realizado'
  },
  {
    value: 'rechazo_pago',
    label: 'Rechazo de pago'
  },
  {
    value: 'datos_incorrectos',
    label: 'Datos incorrectos'
  },
  {
    value: 'cerrado',
    label: 'Cerrado'
  }
]

export const CARTERA_ESTADO_LABEL = Object.fromEntries(
  CARTERA_ESTADOS.map(item => [
    item.value,
    item.label
  ])
)

export function formatMoney(value) {
  if (
    value === null
    || value === undefined
    || value === ''
  ) {
    return '—'
  }

  const number = Number(value)

  if (!Number.isFinite(number)) {
    return String(value)
  }

  return new Intl.NumberFormat(
    'es-MX',
    {
      style: 'currency',
      currency: 'MXN'
    }
  ).format(number)
}

export function formatDate(value) {
  if (!value) {
    return '—'
  }

  const text = String(value).slice(0, 10)
  const [
    year,
    month,
    day
  ] = text.split('-').map(Number)

  if (!year || !month || !day) {
    return String(value)
  }

  return [
    String(day).padStart(2, '0'),
    String(month).padStart(2, '0'),
    year
  ].join('/')
}

export function formatDateTime(value) {
  if (!value) {
    return '—'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return String(value)
  }

  return date.toLocaleString(
    'es-MX',
    {
      dateStyle: 'medium',
      timeStyle: 'short'
    }
  )
}
