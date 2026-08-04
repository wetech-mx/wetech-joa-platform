'use strict'

const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')

const {
  normalizeSecretReference
} = require(
  '../repositories/integrations-secret-repository'
)

const DEFAULT_STORE_DIRECTORY =
  '/etc/wetech-crm/integraciones'
const DEFAULT_REGISTRY_PATH = path.join(
  DEFAULT_STORE_DIRECTORY,
  'referencias.json'
)
const DEFAULT_SECRET_DIRECTORY = path.join(
  DEFAULT_STORE_DIRECTORY,
  'secretos'
)
const ENVIRONMENT_NAME_PATTERN =
  /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/
const CONFIGURATION_KEY_PATTERN =
  /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/

class IntegrationSecretResolverError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'IntegrationSecretResolverError'
    this.code = code
  }
}

function resolverError(code, message) {
  return new IntegrationSecretResolverError(
    code,
    message
  )
}

function permissionBits(stats) {
  return stats.mode & 0o777
}

function assertRootOwned(stats, code) {
  if (stats.uid !== 0) {
    throw resolverError(
      code,
      'La configuración segura debe pertenecer a root'
    )
  }
}

function assertSecureDirectory(directoryPath) {
  let stats

  try {
    stats = fs.lstatSync(directoryPath)
  } catch {
    throw resolverError(
      'INTEGRATION_SECRET_STORE_NOT_FOUND',
      'El almacén seguro no existe'
    )
  }

  if (
    stats.isSymbolicLink()
    || !stats.isDirectory()
  ) {
    throw resolverError(
      'INTEGRATION_SECRET_STORE_INVALID',
      'El almacén seguro no es un directorio regular'
    )
  }

  assertRootOwned(
    stats,
    'INTEGRATION_SECRET_STORE_OWNER_INVALID'
  )

  if (permissionBits(stats) !== 0o700) {
    throw resolverError(
      'INTEGRATION_SECRET_STORE_PERMISSIONS_INVALID',
      'El almacén seguro debe usar permisos 700'
    )
  }

  return stats
}

function assertSecureFile(filePath, {
  notFoundCode = 'INTEGRATION_SECRET_FILE_NOT_FOUND',
  invalidCode = 'INTEGRATION_SECRET_FILE_INVALID'
} = {}) {
  let stats

  try {
    stats = fs.lstatSync(filePath)
  } catch {
    throw resolverError(
      notFoundCode,
      'El archivo seguro no existe'
    )
  }

  if (
    stats.isSymbolicLink()
    || !stats.isFile()
  ) {
    throw resolverError(
      invalidCode,
      'El archivo seguro debe ser regular y no un enlace'
    )
  }

  assertRootOwned(
    stats,
    'INTEGRATION_SECRET_FILE_OWNER_INVALID'
  )

  const mode = permissionBits(stats)

  if (
    (mode & 0o077) !== 0
    || (mode & 0o400) === 0
    || (mode & 0o111) !== 0
  ) {
    throw resolverError(
      'INTEGRATION_SECRET_FILE_PERMISSIONS_INVALID',
      'El archivo seguro debe ser legible solo por root'
    )
  }

  return stats
}

function assertResolvedInsideDirectory(
  filePath,
  directoryPath,
  code
) {
  let realFilePath
  let realDirectoryPath

  try {
    realFilePath = fs.realpathSync(filePath)
    realDirectoryPath = fs.realpathSync(directoryPath)
  } catch {
    throw resolverError(
      code,
      'No fue posible validar la ubicación segura'
    )
  }

  if (!isInsideDirectory(
    realFilePath,
    realDirectoryPath
  )) {
    throw resolverError(
      code,
      'El archivo está fuera de la ubicación permitida'
    )
  }
}

function parseRegistry(content) {
  let parsed

  try {
    parsed = JSON.parse(content)
  } catch {
    throw resolverError(
      'INTEGRATION_SECRET_REGISTRY_JSON_INVALID',
      'El registro de referencias no contiene JSON válido'
    )
  }

  if (
    !parsed
    || parsed.version !== 1
    || !parsed.referencias
    || Array.isArray(parsed.referencias)
    || typeof parsed.referencias !== 'object'
  ) {
    throw resolverError(
      'INTEGRATION_SECRET_REGISTRY_INVALID',
      'El registro de referencias no tiene el formato esperado'
    )
  }

  return parsed
}

function readRegistry({
  storeDirectory = DEFAULT_STORE_DIRECTORY,
  registryPath = DEFAULT_REGISTRY_PATH
} = {}) {
  assertSecureDirectory(storeDirectory)
  assertSecureFile(registryPath, {
    notFoundCode: 'INTEGRATION_SECRET_REGISTRY_NOT_FOUND',
    invalidCode: 'INTEGRATION_SECRET_REGISTRY_INVALID'
  })
  assertResolvedInsideDirectory(
    registryPath,
    storeDirectory,
    'INTEGRATION_SECRET_REGISTRY_OUTSIDE_STORE'
  )

  const content = fs.readFileSync(
    registryPath,
    'utf8'
  )

  return parseRegistry(content)
}

function isInsideDirectory(filePath, directoryPath) {
  const relative = path.relative(
    path.resolve(directoryPath),
    path.resolve(filePath)
  )

  return (
    relative !== ''
    && !relative.startsWith(`..${path.sep}`)
    && relative !== '..'
    && !path.isAbsolute(relative)
  )
}

function validateRequiredKeys(value) {
  if (value === undefined) {
    return []
  }

  if (
    !Array.isArray(value)
    || value.some(key => (
      typeof key !== 'string'
      || !CONFIGURATION_KEY_PATTERN.test(key)
    ))
  ) {
    throw resolverError(
      'INTEGRATION_SECRET_REGISTRY_ENTRY_INVALID',
      'Las llaves requeridas no son válidas'
    )
  }

  return [...new Set(value)]
}

function assertAllowedKeys(entry, allowedKeys) {
  const unknown = Object.keys(entry)
    .filter(key => !allowedKeys.includes(key))

  if (unknown.length > 0) {
    throw resolverError(
      'INTEGRATION_SECRET_REGISTRY_ENTRY_INVALID',
      'La referencia contiene propiedades no permitidas'
    )
  }
}

function validateRegistryEntry(
  reference,
  entry,
  {
    secretDirectory = DEFAULT_SECRET_DIRECTORY
  } = {}
) {
  if (
    !entry
    || Array.isArray(entry)
    || typeof entry !== 'object'
  ) {
    throw resolverError(
      'INTEGRATION_SECRET_REGISTRY_ENTRY_INVALID',
      'La referencia no tiene una configuración válida'
    )
  }

  const [scheme] = reference.split(':', 1)

  if (scheme === 'entorno') {
    assertAllowedKeys(entry, [
      'fuente',
      'variable'
    ])

    if (
      entry.fuente !== 'entorno'
      || typeof entry.variable !== 'string'
      || !ENVIRONMENT_NAME_PATTERN.test(
        entry.variable
      )
    ) {
      throw resolverError(
        'INTEGRATION_SECRET_REGISTRY_ENTRY_INVALID',
        'La referencia de entorno no es válida'
      )
    }

    return {
      scheme,
      source: 'entorno',
      environmentName: entry.variable,
      requiredKeys: []
    }
  }

  assertAllowedKeys(entry, [
    'fuente',
    'ruta',
    'llaves_requeridas'
  ])

  if (
    !['archivo_env', 'archivo_texto']
      .includes(entry.fuente)
    || typeof entry.ruta !== 'string'
    || !path.isAbsolute(entry.ruta)
  ) {
    throw resolverError(
      'INTEGRATION_SECRET_REGISTRY_ENTRY_INVALID',
      'La referencia de archivo no es válida'
    )
  }

  if (
    scheme === 'archivo_seguro'
    && !isInsideDirectory(
      entry.ruta,
      secretDirectory
    )
  ) {
    throw resolverError(
      'INTEGRATION_SECRET_PATH_OUTSIDE_STORE',
      'El archivo debe permanecer dentro del almacén seguro'
    )
  }

  return {
    scheme,
    source: entry.fuente,
    filePath: path.resolve(entry.ruta),
    requiredKeys: validateRequiredKeys(
      entry.llaves_requeridas
    )
  }
}

function assertRequiredConfiguration(
  configuration,
  requiredKeys
) {
  const missing = requiredKeys.filter(key => (
    !Object.hasOwn(configuration, key)
    || String(configuration[key]).length === 0
  ))

  if (missing.length > 0) {
    throw resolverError(
      'INTEGRATION_SECRET_REQUIRED_KEY_MISSING',
      'La configuración segura está incompleta'
    )
  }
}

function resolveSecretReference(
  reference,
  {
    env = process.env,
    storeDirectory = DEFAULT_STORE_DIRECTORY,
    registryPath = DEFAULT_REGISTRY_PATH,
    secretDirectory = DEFAULT_SECRET_DIRECTORY
  } = {}
) {
  const normalizedReference =
    normalizeSecretReference(reference)
  const registry = readRegistry({
    storeDirectory,
    registryPath
  })
  const entry = registry.referencias[
    normalizedReference
  ]

  if (!entry) {
    throw resolverError(
      'INTEGRATION_SECRET_REFERENCE_NOT_REGISTERED',
      'La referencia segura no está registrada'
    )
  }

  const validated = validateRegistryEntry(
    normalizedReference,
    entry,
    { secretDirectory }
  )

  if (validated.source === 'entorno') {
    const value = env[validated.environmentName]

    if (
      typeof value !== 'string'
      || value.length === 0
    ) {
      throw resolverError(
        'INTEGRATION_SECRET_ENVIRONMENT_MISSING',
        'La variable segura no está disponible'
      )
    }

    return {
      source: validated.source,
      value,
      fieldCount: 1
    }
  }

  if (validated.scheme === 'archivo_seguro') {
    assertSecureDirectory(secretDirectory)
  }

  assertSecureFile(validated.filePath)

  if (validated.scheme === 'archivo_seguro') {
    assertResolvedInsideDirectory(
      validated.filePath,
      secretDirectory,
      'INTEGRATION_SECRET_PATH_OUTSIDE_STORE'
    )
  }

  const content = fs.readFileSync(
    validated.filePath,
    'utf8'
  )

  if (content.length === 0) {
    throw resolverError(
      'INTEGRATION_SECRET_FILE_EMPTY',
      'El archivo seguro está vacío'
    )
  }

  if (validated.source === 'archivo_texto') {
    return {
      source: validated.source,
      value: content,
      fieldCount: 1
    }
  }

  const configuration = dotenv.parse(content)

  assertRequiredConfiguration(
    configuration,
    validated.requiredKeys
  )

  if (Object.keys(configuration).length === 0) {
    throw resolverError(
      'INTEGRATION_SECRET_FILE_EMPTY',
      'El archivo seguro no contiene configuración'
    )
  }

  return {
    source: validated.source,
    value: configuration,
    fieldCount: Object.keys(configuration).length
  }
}

module.exports = {
  DEFAULT_REGISTRY_PATH,
  DEFAULT_SECRET_DIRECTORY,
  DEFAULT_STORE_DIRECTORY,
  IntegrationSecretResolverError,
  assertSecureDirectory,
  assertSecureFile,
  assertResolvedInsideDirectory,
  isInsideDirectory,
  parseRegistry,
  readRegistry,
  resolveSecretReference,
  validateRegistryEntry
}
