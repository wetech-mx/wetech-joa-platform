const test = require('node:test')
const assert = require('node:assert/strict')

const {
  formatDateForBank,
  validateDate
} = require('../integrations/banco-azteca/service')

test('acepta una fecha calendario válida', () => {
  assert.equal(validateDate('2026-07-27'), '2026-07-27')
})

test('convierte la fecha del calendario al formato del banco', () => {
  assert.equal(formatDateForBank('2026-04-21'), '21-04-2026')
  assert.equal(formatDateForBank('2026-07-28'), '28-07-2026')
})

test('rechaza fechas imposibles o con otro formato', () => {
  assert.throws(() => validateDate('27/07/2026'), /formato/)
  assert.throws(() => validateDate('2026-02-30'), /no es válida/)
})
