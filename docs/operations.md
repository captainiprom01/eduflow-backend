# EduFlow operations runbook

## Database migrations

Run migrations before deploying the API:

```bash
npm ci --omit=dev
npm run migrate
npm start
```

Migrations are recorded in `schema_migrations` and are applied once in filename order.

## Backups

Use the provider's encrypted, point-in-time backup feature where available. For an additional logical backup, run from a trusted environment with the production `DATABASE_URL` supplied through the environment, never committed to the repository:

```bash
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" > "eduflow-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Store dumps in encrypted, access-controlled storage. Test a restore at least monthly into an isolated database:

```bash
createdb eduflow_restore_check
pg_restore --clean --if-exists --no-owner --dbname eduflow_restore_check backup.dump
```

Never restore production data into a developer database without redaction and authorization.

## Health monitoring

Monitor these endpoints from the hosting platform:

- `GET /health/live`: process liveness; no database query.
- `GET /health/ready`: database readiness; alert after repeated non-200 responses.
- `GET /`: basic service smoke check.

Capture request logs as JSON and alert on sustained 5xx responses, elevated latency, database pool errors, failed migrations, and failed scheduled jobs.

## Scheduled jobs

The reminder and weekly recap endpoints use a stable `job_runs` key. A succeeded run for the same key is skipped, a recent running job is skipped, and a failed or stale run can be retried. Keep the GitHub Actions schedule and `CRON_SECRET` protected; do not put the secret in URLs when a header can be used.

## Security operations

- Rotate `JWT_SECRET` only with a planned session invalidation window.
- Rotate `CRON_SECRET` after updating the GitHub Actions secret and deployment environment.
- Revoke active sessions through the database only as an incident-response action:

```sql
UPDATE user_sessions SET revoked_at = now() WHERE user_id = 123;
```

- Review dependency audit results on every CI run and investigate high-severity findings.
