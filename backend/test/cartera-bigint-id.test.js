const test = require('node:test')
const assert = require('node:assert/strict')

const {
  isPositiveDatabaseId,
  validateAssignmentInput
} = require('../importers/cartera-round-robin')

const client = {
  query() {}
}

test(
  'acepta BIGSERIAL de PostgreSQL como texto',
  () => {
    assert.equal(
      isPositiveDatabaseId('101'),
      true
    )
    assert.equal(
      isPositiveDatabaseId(
        '9007199254740993'
      ),
      true
    )

    assert.doesNotThrow(
      () => validateAssignmentInput({
        client,
        empresaId: 1,
        cuentaId: '9007199254740993',
        idCampania: 'CAMP-1'
      })
    )
  }
)

test(
  'conserva compatibilidad con enteros seguros',
  () => {
    assert.equal(
      isPositiveDatabaseId(101),
      true
    )

    assert.doesNotThrow(
      () => validateAssignmentInput({
        client,
        empresaId: 1,
        cuentaId: 101,
        idCampania: 'CAMP-1'
      })
    )
  }
)

test(
  'rechaza identificadores inválidos',
  () => {
    for (const value of [
      0,
      -1,
      Number.NaN,
      '',
      '0',
      '-1',
      '1.5',
      '01',
      null
    ]) {
      assert.equal(
        isPositiveDatabaseId(value),
        false
      )
    }
  }
)
