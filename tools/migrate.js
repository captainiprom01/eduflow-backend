require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const { pool } = require('../db');
const logger = require('../lib/logger');

async function migrate() {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    const existing = await pool.query('SELECT 1 FROM schema_migrations WHERE id = $1', [id]);
    if (existing.rowCount) continue;

    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id]);
      await client.query('COMMIT');
      logger.info('database.migration_applied', { migration: id });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

migrate()
  .then(async () => {
    await pool.end();
    logger.info('database.migrations_complete');
  })
  .catch(async (error) => {
    logger.error('database.migrations_failed', { error: error.message, stack: error.stack });
    await pool.end();
    process.exitCode = 1;
  });
