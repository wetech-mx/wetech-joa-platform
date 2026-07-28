const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  checksumFor,
  generateDailyPortfolio,
  parseHolidays,
  previousBusinessDay
} = require('../scripts/export-banco-azteca-daily')

test('martes selecciona el lunes anterior', () => {
  const result = previousBusinessDay(
    new Date('2026-07-28T12:00:00Z')
  )

  assert.equal(result, '2026-07-27')
})

test('lunes selecciona el viernes anterior', () => {
  const result = previousBusinessDay(
    new Date('2026-07-27T12:00:00Z')
  )

  assert.equal(result, '2026-07-24')
})

test('respeta la fecha de Ciudad de México cerca de medianoche UTC', () => {
  const result = previousBusinessDay(
    new Date('2026-07-28T02:00:00Z')
  )

  assert.equal(result, '2026-07-24')
})

test('omite días festivos configurados', () => {
  const result = previousBusinessDay(
    new Date('2026-07-28T12:00:00Z'),
    {
      holidays: parseHolidays('2026-07-27')
    }
  )

  assert.equal(result, '2026-07-24')
})

test('rechaza días festivos con formato inválido', () => {
  assert.throws(
    () => parseHolidays('27/07/2026'),
    /BAZ_HOLIDAYS contiene una fecha inválida/
  )
})

test('genera el Excel y su suma SHA-256 una sola vez', async () => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'banco-azteca-daily-')
  )
  const buffer = Buffer.from('excel-controlado')
  let calls = 0

  const exportFn = async date => {
    calls++
    assert.equal(date, '2026-07-27')

    return {
      buffer,
      fileName: `Cartera_BancoAzteca_${date}.xlsx`,
      campaigns: 2,
      clients: 200
    }
  }

  try {
    const env = {
      BAZ_EXPORT_OUTBOX: directory
    }
    const now = new Date('2026-07-28T12:00:00Z')

    const first = await generateDailyPortfolio({
      now,
      env,
      exportFn
    })

    assert.equal(first.status, 'generated')
    assert.equal(first.campaigns, 2)
    assert.equal(first.clients, 200)
    assert.equal(calls, 1)

    const stored = await fs.promises.readFile(first.filePath)
    assert.deepEqual(stored, buffer)

    const checksum = await fs.promises.readFile(
      first.checksumPath,
      'utf8'
    )
    assert.equal(
      checksum,
      `${checksumFor(buffer)}  ${first.fileName}\n`
    )

    const second = await generateDailyPortfolio({
      now,
      env,
      exportFn
    })

    assert.equal(second.status, 'already_exists')
    assert.equal(calls, 1)
  } finally {
    await fs.promises.rm(directory, {
      recursive: true,
      force: true
    })
  }
})

test('permite fecha explícita para una ejecución controlada', async () => {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'banco-azteca-date-')
  )

  try {
    const result = await generateDailyPortfolio({
      env: {
        BAZ_EXPORT_DATE: '2026-04-21',
        BAZ_EXPORT_OUTBOX: directory
      },
      exportFn: async date => ({
        buffer: Buffer.from(date),
        campaigns: 2,
        clients: 200
      })
    })

    assert.equal(result.date, '2026-04-21')
    assert.equal(
      result.fileName,
      'Cartera_BancoAzteca_2026-04-21.xlsx'
    )
  } finally {
    await fs.promises.rm(directory, {
      recursive: true,
      force: true
    })
  }
})
