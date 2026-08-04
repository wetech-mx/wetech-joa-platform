'use strict'

const {
  configureSecretReference,
  findIntegrationTarget,
  normalizeSecretReference
} = require(
  '../repositories/integrations-secret-repository'
)

const VALUE_OPTIONS = new Map([
  ['--empresa-id', 'empresaId'],
  ['--integracion-id', 'integrationId'],
  ['--referencia', 'reference']
])

function parseArguments(argv) {
  const result = {
    empresaId: '',
    integrationId: '',
    reference: '',
    confirm: false
  }

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]

    if (argument === '--confirmar') {
      result.confirm = true
      continue
    }

    const [option, inlineValue] = argument.split('=', 2)
    const property = VALUE_OPTIONS.get(option)

    if (!property) {
      throw new Error(
        `Opción no permitida: ${option}`
      )
    }

    const value = inlineValue === undefined
      ? argv[++index]
      : inlineValue

    if (!value || value.startsWith('--')) {
      throw new Error(
        `Falta el valor de ${option}`
      )
    }

    result[property] = value
  }

  if (
    !result.empresaId
    || !result.integrationId
    || !result.reference
  ) {
    throw new Error(
      'Se requieren --empresa-id, --integracion-id y --referencia'
    )
  }

  normalizeSecretReference(result.reference)

  return result
}

async function executeConfiguration({
  pool,
  options,
  logger = console
}) {
  const target = await findIntegrationTarget({
    pool,
    empresaId: options.empresaId,
    integrationId: options.integrationId
  })

  logger.log('INTEGRACION_ENCONTRADA=SI')
  logger.log(`INTEGRACION_ID=${target.id}`)
  logger.log(`INTEGRACION_CODIGO=${target.codigo}`)
  logger.log('REFERENCIA_FORMATO=OK')
  logger.log('REFERENCIA_VALOR_MOSTRADO=NO')

  if (!options.confirm) {
    logger.log('POSTGRESQL_MODIFICADO=NO')
    logger.log('MODO=VALIDACION')
    return {
      status: 'validated',
      target
    }
  }

  const updated = await configureSecretReference({
    pool,
    empresaId: options.empresaId,
    integrationId: options.integrationId,
    reference: options.reference
  })

  logger.log('REFERENCIA_VINCULADA=OK')
  logger.log('SECRETO_MOSTRADO=NO')
  logger.log('POSTGRESQL_MODIFICADO=SI')

  return {
    status: 'configured',
    target: updated
  }
}

async function main() {
  require('dotenv').config()

  const pool = require('../config/database')

  try {
    const options = parseArguments(
      process.argv.slice(2)
    )

    await executeConfiguration({
      pool,
      options
    })
  } catch (error) {
    console.error(
      'CONFIGURACION_REFERENCIA_ERROR:',
      error.code || error.message
    )
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  executeConfiguration,
  parseArguments
}
