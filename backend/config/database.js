const { Pool } = require('pg')

const {
  buildDatabaseEnvironment
} = require('./database-environment')

const {
  configuration
} = buildDatabaseEnvironment()

const pool = new Pool({
  user: configuration.DB_USER,
  host: configuration.DB_HOST,
  database: configuration.DB_NAME,
  password: configuration.DB_PASSWORD,
  port: configuration.DB_PORT,
})

module.exports = pool
