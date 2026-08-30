'use strict'

require('dotenv').config()

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  buildDatabaseEnvironment
} = require('../config/database-environment')

const BACKUP_PREFIX = 'wetech_db-auto-'
const DEFAULT_BACKUP_DIR = '/opt/backups/crm/automatic'
const DEFAULT_RETENTION_DAYS = 30

function parseRetentionDays(rawValue) {
  const value = Number.parseInt(rawValue, 10)

  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new Error('CRM_BACKUP_RETENTION_DAYS debe estar entre 1 y 3650')
  }

  return value
}

function utcTimestamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || '').trim()
    throw new Error(
      `${path.basename(command)} terminó con código ${result.status}` +
      (details ? `: ${details}` : '')
    )
  }

  return result
}

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')
}

function removeExpiredBackups(backupDir, retentionDays, now = Date.now()) {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000
  const pattern = /^wetech_db-auto-\d{8}T\d{6}Z\.dump$/
  const removed = []

  for (const entry of fs.readdirSync(backupDir, { withFileTypes: true })) {
    if (!entry.isFile() || !pattern.test(entry.name)) continue

    const dumpPath = path.join(backupDir, entry.name)
    const metadata = fs.statSync(dumpPath)

    if (metadata.mtimeMs >= cutoff) continue

    fs.rmSync(dumpPath)
    fs.rmSync(`${dumpPath}.sha256`, { force: true })
    removed.push(entry.name)
  }

  return removed
}

function main() {
  process.umask(0o077)

  const backupDir = path.resolve(
    process.env.CRM_BACKUP_DIR || DEFAULT_BACKUP_DIR
  )
  const retentionDays = parseRetentionDays(
    process.env.CRM_BACKUP_RETENTION_DAYS ||
      String(DEFAULT_RETENTION_DAYS)
  )
  const { configuration } = buildDatabaseEnvironment()
  const timestamp = utcTimestamp()
  const filename = `${BACKUP_PREFIX}${timestamp}.dump`
  const finalPath = path.join(backupDir, filename)
  const partialPath = `${finalPath}.partial`

  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  fs.chmodSync(backupDir, 0o700)

  try {
    runCommand(
      '/usr/bin/pg_dump',
      [
        '--host', String(configuration.DB_HOST),
        '--port', String(configuration.DB_PORT),
        '--username', String(configuration.DB_USER),
        '--dbname', String(configuration.DB_NAME),
        '--format', 'custom',
        '--no-password',
        '--file', partialPath
      ],
      {
        env: {
          ...process.env,
          PGPASSWORD: String(configuration.DB_PASSWORD)
        },
        stdio: ['ignore', 'ignore', 'pipe']
      }
    )

    const metadata = fs.statSync(partialPath)

    if (metadata.size === 0) {
      throw new Error('pg_dump generó un archivo vacío')
    }

    runCommand(
      '/usr/bin/pg_restore',
      ['--list', partialPath],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    )

    const sha256 = sha256File(partialPath)

    fs.renameSync(partialPath, finalPath)
    fs.chmodSync(finalPath, 0o600)
    fs.writeFileSync(
      `${finalPath}.sha256`,
      `${sha256}  ${filename}\n`,
      { mode: 0o600 }
    )

    const removed = removeExpiredBackups(
      backupDir,
      retentionDays
    )

    console.log(JSON.stringify({
      success: true,
      backup: finalPath,
      bytes: metadata.size,
      sha256,
      retentionDays,
      removed
    }))
  } finally {
    fs.rmSync(partialPath, { force: true })
  }
}

try {
  main()
} catch (error) {
  console.error(`CRM_BACKUP_ERROR: ${error.message}`)
  process.exitCode = 1
}
