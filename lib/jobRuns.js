const { pool } = require('../db');
const logger = require('./logger');

async function beginJob(jobKey) {
  const result = await pool.query(
    `INSERT INTO job_runs (job_key, status, started_at, finished_at, result, error)
     VALUES ($1, 'running', now(), NULL, NULL, NULL)
     ON CONFLICT (job_key) DO UPDATE
       SET status = 'running', started_at = now(), finished_at = NULL, result = NULL, error = NULL
       WHERE job_runs.status = 'failed' OR (job_runs.status = 'running' AND job_runs.started_at < now() - interval '30 minutes')
     RETURNING job_key`,
    [jobKey]
  );
  if (!result.rowCount) return false;
  logger.info('job.started', { jobKey });
  return true;
}

async function finishJob(jobKey, result) {
  await pool.query(
    `UPDATE job_runs SET status = 'succeeded', finished_at = now(), result = $2, error = NULL WHERE job_key = $1`,
    [jobKey, result]
  );
  logger.info('job.succeeded', { jobKey, result });
}

async function failJob(jobKey, error) {
  await pool.query(
    `UPDATE job_runs SET status = 'failed', finished_at = now(), error = $2 WHERE job_key = $1`,
    [jobKey, error.message]
  );
  logger.error('job.failed', { jobKey, error: error.message });
}

module.exports = { beginJob, finishJob, failJob };
