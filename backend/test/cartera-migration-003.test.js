const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const migrationPath = path.join(
  __dirname,
  '../migrations/003_allow_signed_delay_values.sql'
)

const sql = fs.readFileSync(
  migrationPath,
  'utf8'
)

test(
  'elimina únicamente los checks de atraso',
  () => {
    assert.match(
      sql,
      /DROP CONSTRAINT\s+cartera_snapshots_semanas_atraso_check/
    )
    assert.match(
      sql,
      /DROP CONSTRAINT\s+cartera_snapshots_dias_atraso_check/
    )
  }
)

test(
  'conserva el check de edad',
  () => {
    assert.doesNotMatch(
      sql,
      /DROP CONSTRAINT\s+cartera_snapshots_edad_check/
    )
  }
)

test(
  'registra la versión 003',
  () => {
    assert.match(
      sql,
      /003_allow_signed_delay_values/
    )
    assert.match(
      sql,
      /ON CONFLICT \(version\) DO NOTHING/
    )
  }
)
