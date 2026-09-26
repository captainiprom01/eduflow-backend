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

test('responses include security headers and only allow the configured frontend origin', async () => {
  const allowed = await request(app).get('/').set('Origin', 'https://example.test');
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://example.test');
  assert.equal(allowed.headers['access-control-allow-credentials'], 'true');
  assert.equal(allowed.headers['x-content-type-options'], 'nosniff');
  assert.equal(allowed.headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(allowed.headers['content-security-policy'], /default-src 'self'/);
  assert.doesNotMatch(allowed.headers['content-security-policy'], /content-security-policy false/);

  const denied = await request(app).get('/').set('Origin', 'https://attacker.example');
  assert.equal(denied.status, 200);
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});

test('OpenAPI document is available without authentication', async () => {
  const response = await request(app).get('/api/openapi.json');
  assert.equal(response.status, 200);
  assert.equal(response.body.openapi, '3.0.3');
  assert.ok(response.body.paths['/api/auth/logout']);
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
