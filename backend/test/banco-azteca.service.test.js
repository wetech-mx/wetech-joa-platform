const test = require('node:test')
const assert = require('node:assert/strict')

const {
  validateDate
} = require('../integrations/banco-azteca/service')

test('acepta una fecha calendario válida', () => {
  assert.equal(validateDate('2026-07-27'), '2026-07-27')
})

test('rechaza fechas imposibles o con otro formato', () => {
  assert.throws(() => validateDate('27/07/2026'), /formato/)
  assert.throws(() => validateDate('2026-02-30'), /no es válida/)
})
