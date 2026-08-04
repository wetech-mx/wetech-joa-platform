'use strict'

const {
  DEFAULT_REGISTRY_PATH,
  DEFAULT_STORE_DIRECTORY,
  resolveSecretReference
} = require(
  '../integrations/integration-secret-resolver'
)

function parseArguments(argv) {
  const options = {
    reference: '',
    registryPath: DEFAULT_REGISTRY_PATH,
    storeDirectory: DEFAULT_STORE_DIRECTORY
  }

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    const [name, inlineValue] = argument.split('=', 2)

    if (![
      '--referencia',
      '--registro',
      '--almacen'
    ].includes(name)) {
      throw new Error(
        `Opción no permitida: ${name}`
      )
    }

    const value = inlineValue === undefined
      ? argv[++index]
      : inlineValue

    if (!value || value.startsWith('--')) {
      throw new Error(`Falta el valor de ${name}`)
    }

    if (name === '--referencia') {
      options.reference = value
    } else if (name === '--registro') {
      options.registryPath = value
    } else {
      options.storeDirectory = value
    }
  }

  if (!options.reference) {
    throw new Error('Se requiere --referencia')
  }

  return options
}

function executeValidation({
  options,
  logger = console,
  resolver = resolveSecretReference
}) {
  const resolved = resolver(
    options.reference,
    {
      registryPath: options.registryPath,
      storeDirectory: options.storeDirectory
    }
  )

  logger.log('ALMACEN_SEGURO=OK')
  logger.log('REGISTRO_REFERENCIAS=OK')
  logger.log('REFERENCIA_RESUELTA=OK')
  logger.log(`TIPO_FUENTE=${resolved.source}`)
  logger.log(`CAMPOS_CARGADOS=${resolved.fieldCount}`)
  logger.log('VALOR_MOSTRADO=NO')
  logger.log('POSTGRESQL_MODIFICADO=NO')

  return {
    status: 'validated',
    source: resolved.source,
    fieldCount: resolved.fieldCount
  }
}

function main() {
  try {
    const options = parseArguments(
      process.argv.slice(2)
    )

    executeValidation({ options })
  } catch (error) {
    console.error(
      'VALIDACION_ALMACEN_ERROR:',
      error.code || error.message
    )
    process.exitCode = 1
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  executeValidation,
  parseArguments
}
