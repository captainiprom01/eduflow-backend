const assert = require('node:assert/strict');
const test = require('node:test');
const request = require('supertest');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/eduflow_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-at-least-32-characters-long';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://example.test';
process.env.NODE_ENV = 'test';

const { app, shutdown } = require('../server');

test.after(async () => {
  await shutdown('test');
});

test('root endpoint returns service metadata and request ID', async () => {
  const response = await request(app).get('/');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/);
});

test('liveness endpoint does not require database access', async () => {
  const response = await request(app).get('/health/live');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
});

test('unknown routes return a stable error contract', async () => {
  const response = await request(app).get('/does-not-exist');
  assert.equal(response.status, 404);
  assert.equal(response.body.code, 'ROUTE_NOT_FOUND');
  assert.ok(response.body.requestId);
});

test('protected quote route rejects unauthenticated access', async () => {
  const response = await request(app).get('/api/quotes/daily?date=2026-09-26');
  assert.equal(response.status, 401);
  assert.match(response.body.error, /authentication token/i);
});

test('cookie-authenticated mutations reject untrusted origins', async () => {
  const response = await request(app)
    .post('/api/auth/logout')
    .set('Cookie', 'eduflow_session=placeholder')
    .set('Origin', 'https://attacker.example');
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'CSRF_ORIGIN_REJECTED');
});
