const { Pool } = require('pg');
const { config } = require('./config');

const isLocalDatabase = config.databaseUrl.includes('localhost') || config.databaseUrl.includes('127.0.0.1');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
  max: config.databasePoolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error(JSON.stringify({ level: 'error', event: 'database.pool_error', error: err.message }));
});

async function initDb() {
  await pool.query('SELECT 1');
}

module.exports = { pool, initDb };
