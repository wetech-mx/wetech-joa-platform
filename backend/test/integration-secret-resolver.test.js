'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  assertSecureDirectory,
  assertSecureFile,
  resolveSecretReference
} = require(
  '../integrations/integration-secret-resolver'
)
const {
  executeValidation,
  parseArguments
} = require(
  '../scripts/validate-integration-secret-store'
)

function secureFixture(registry, files = {}) {
  const root = fs.mkdtempSync(
    path.join(__dirname, '.integration-secrets-')
  )
  const secretDirectory = path.join(root, 'secretos')
  const registryPath = path.join(root, 'referencias.json')

  fs.chmodSync(root, 0o700)
  fs.mkdirSync(secretDirectory, { mode: 0o700 })
  fs.writeFileSync(
    registryPath,
    JSON.stringify({
      version: 1,
      referencias: registry
    }),
    { mode: 0o600 }
  )

  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(
      path.join(secretDirectory, name),
      content,
      { mode: 0o600 }
    )
  }

  return {
    root,
    registryPath,
    secretDirectory,
    cleanup() {
      fs.rmSync(root, {
        recursive: true,
        force: true
      })
    }
  }
}

function captureLogger() {
  const lines = []

  return {
    lines,
    log(value) {
      lines.push(String(value))
    }
  }
}

test('acepta almacén 700 y archivo root sin permisos compartidos', () => {
  const fixture = secureFixture({})

  try {
    assert.doesNotThrow(
      () => assertSecureDirectory(fixture.root)
    )
    assert.doesNotThrow(
      () => assertSecureFile(fixture.registryPath)
    )
  } finally {
    fixture.cleanup()
  }
})

test('rechaza almacén legible por otros usuarios', () => {
  const fixture = secureFixture({})

  try {
    fs.chmodSync(fixture.root, 0o755)

    assert.throws(
      () => assertSecureDirectory(fixture.root),
      error => (
        error.code
        === 'INTEGRATION_SECRET_STORE_PERMISSIONS_INVALID'
      )
    )
  } finally {
    fixture.cleanup()
  }
})

test('rechaza archivos simbólicos y permisos de grupo', () => {
  const fixture = secureFixture({}, {
    'real.env': 'TOKEN=controlado\n'
  })

  try {
    const realPath = path.join(
      fixture.secretDirectory,
      'real.env'
    )
    const linkPath = path.join(
      fixture.secretDirectory,
      'link.env'
    )

    fs.symlinkSync(realPath, linkPath)

    assert.throws(
      () => assertSecureFile(linkPath),
      error => (
        error.code === 'INTEGRATION_SECRET_FILE_INVALID'
      )
    )

    fs.chmodSync(realPath, 0o640)

    assert.throws(
      () => assertSecureFile(realPath),
      error => (
        error.code
        === 'INTEGRATION_SECRET_FILE_PERMISSIONS_INVALID'
      )
    )
  } finally {
    fixture.cleanup()
  }
})

test('rechaza un directorio secretos que sea enlace simbólico', () => {
  const fixture = secureFixture({})

  try {
    const alternateDirectory = path.join(
      fixture.root,
      'alterno'
    )
    const linkedDirectory = path.join(
      fixture.root,
      'secretos_enlace'
    )
    const filePath = path.join(
      linkedDirectory,
      'cliente.env'
    )

    fs.mkdirSync(alternateDirectory, { mode: 0o700 })
    fs.writeFileSync(
      path.join(alternateDirectory, 'cliente.env'),
      'TOKEN=controlado\n',
      { mode: 0o600 }
    )
    fs.symlinkSync(alternateDirectory, linkedDirectory)
    fs.writeFileSync(
      fixture.registryPath,
      JSON.stringify({
        version: 1,
        referencias: {
          'archivo_seguro:cliente_demo': {
            fuente: 'archivo_env',
            ruta: filePath
          }
        }
      }),
      { mode: 0o600 }
    )

    assert.throws(
      () => resolveSecretReference(
        'archivo_seguro:cliente_demo',
        {
          storeDirectory: fixture.root,
          registryPath: fixture.registryPath,
          secretDirectory: linkedDirectory
        }
      ),
      error => (
        error.code
        === 'INTEGRATION_SECRET_STORE_INVALID'
      )
    )
  } finally {
    fixture.cleanup()
  }
})

test('resuelve archivo env seguro sin transformar valores', () => {
  const fixture = secureFixture({}, {
    'cliente.env': 'USUARIO=demo\nCLAVE=valor_controlado\n'
  })

  try {
    const filePath = path.join(
      fixture.secretDirectory,
      'cliente.env'
    )
    const registry = {
      'archivo_seguro:cliente_demo': {
        fuente: 'archivo_env',
        ruta: filePath,
        llaves_requeridas: ['USUARIO', 'CLAVE']
      }
    }

    fs.writeFileSync(
      fixture.registryPath,
      JSON.stringify({
        version: 1,
        referencias: registry
      }),
      { mode: 0o600 }
    )

    const result = resolveSecretReference(
      'archivo_seguro:cliente_demo',
      {
        storeDirectory: fixture.root,
        registryPath: fixture.registryPath,
        secretDirectory: fixture.secretDirectory
      }
    )

    assert.equal(result.source, 'archivo_env')
    assert.equal(result.fieldCount, 2)
    assert.equal(result.value.USUARIO, 'demo')
    assert.equal(result.value.CLAVE, 'valor_controlado')
  } finally {
    fixture.cleanup()
  }
})

test('resuelve una referencia de entorno registrada', () => {
  const fixture = secureFixture({
    'entorno:cliente_api': {
      fuente: 'entorno',
      variable: 'WETECH_CLIENTE_API'
    }
  })

  try {
    const result = resolveSecretReference(
      'entorno:cliente_api',
      {
        env: {
          WETECH_CLIENTE_API: 'valor_controlado'
        },
        storeDirectory: fixture.root,
        registryPath: fixture.registryPath,
        secretDirectory: fixture.secretDirectory
      }
    )

    assert.equal(result.fieldCount, 1)
    assert.equal(result.value, 'valor_controlado')
  } finally {
    fixture.cleanup()
  }
})

test('rechaza archivo seguro fuera del directorio secretos', () => {
  const fixture = secureFixture({})

  try {
    fs.writeFileSync(
      fixture.registryPath,
      JSON.stringify({
        version: 1,
        referencias: {
          'archivo_seguro:fuera': {
            fuente: 'archivo_env',
            ruta: '/etc/default/no_permitido'
          }
        }
      }),
      { mode: 0o600 }
    )

    assert.throws(
      () => resolveSecretReference(
        'archivo_seguro:fuera',
        {
          storeDirectory: fixture.root,
          registryPath: fixture.registryPath,
          secretDirectory: fixture.secretDirectory
        }
      ),
      error => (
        error.code
        === 'INTEGRATION_SECRET_PATH_OUTSIDE_STORE'
      )
    )
  } finally {
    fixture.cleanup()
  }
})

test('rechaza propiedades que podrían incrustar secretos en el registro', () => {
  const fixture = secureFixture({
    'entorno:cliente_api': {
      fuente: 'entorno',
      variable: 'WETECH_CLIENTE_API',
      valor: 'no_permitido'
    }
  })

  try {
    assert.throws(
      () => resolveSecretReference(
        'entorno:cliente_api',
        {
          env: {
            WETECH_CLIENTE_API: 'controlado'
          },
          storeDirectory: fixture.root,
          registryPath: fixture.registryPath,
          secretDirectory: fixture.secretDirectory
        }
      ),
      error => (
        error.code
        === 'INTEGRATION_SECRET_REGISTRY_ENTRY_INVALID'
      )
    )
  } finally {
    fixture.cleanup()
  }
})

test('rechaza configuración que omite una llave requerida', () => {
  const fixture = secureFixture({}, {
    'incompleto.env': 'USUARIO=demo\n'
  })

  try {
    const filePath = path.join(
      fixture.secretDirectory,
      'incompleto.env'
    )

    fs.writeFileSync(
      fixture.registryPath,
      JSON.stringify({
        version: 1,
        referencias: {
          'archivo_seguro:incompleto': {
            fuente: 'archivo_env',
            ruta: filePath,
            llaves_requeridas: ['USUARIO', 'CLAVE']
          }
        }
      }),
      { mode: 0o600 }
    )

    assert.throws(
      () => resolveSecretReference(
        'archivo_seguro:incompleto',
        {
          storeDirectory: fixture.root,
          registryPath: fixture.registryPath,
          secretDirectory: fixture.secretDirectory
        }
      ),
      error => (
        error.code
        === 'INTEGRATION_SECRET_REQUIRED_KEY_MISSING'
      )
    )
  } finally {
    fixture.cleanup()
  }
})

test('el validador no imprime referencia, ruta ni valor', () => {
  const logger = captureLogger()
  const options = parseArguments([
    '--referencia',
    'servidor:backend_env_banco_azteca'
  ])

  const result = executeValidation({
    options,
    logger,
    resolver() {
      return {
        source: 'archivo_env',
        value: {
          TOKEN: 'valor_controlado'
        },
        fieldCount: 1
      }
    }
  })

  assert.equal(result.status, 'validated')
  assert.ok(logger.lines.includes('VALOR_MOSTRADO=NO'))
  assert.ok(logger.lines.includes('POSTGRESQL_MODIFICADO=NO'))
  assert.equal(
    logger.lines.some(line => (
      line.includes('backend_env_banco_azteca')
      || line.includes('valor_controlado')
      || line.includes('/etc/')
    )),
    false
  )
})

test('el validador rechaza opciones que podrían incluir secretos', () => {
  assert.throws(
    () => parseArguments([
      '--referencia',
      'entorno:cliente_api',
      '--token',
      'valor'
    ]),
    /Opción no permitida/
  )
})
