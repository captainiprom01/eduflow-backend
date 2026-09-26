const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || 'eduflow_session';

function cookieOptions() {
  const sameSite = process.env.SESSION_COOKIE_SAMESITE || 'lax';
  return [
    `${SESSION_COOKIE}=`,
    'HttpOnly',
    'Path=/',
    `SameSite=${sameSite}`,
    ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
  ].join('; ');
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter((entry) => entry.length));
  const token = bearer || cookies[SESSION_COOKIE];
  if (!token) return res.status(401).json({ error: 'Missing authentication token.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!payload.jti || !Number.isInteger(Number(payload.userId)) || Number(payload.userId) <= 0) throw new Error('Invalid session');
    const active = await pool.query(
      'SELECT 1 FROM user_sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()',
      [payload.jti, Number(payload.userId)]
    );
    if (!active.rowCount) throw new Error('Inactive session');
    req.userId = Number(payload.userId);
    req.sessionId = payload.jti;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }
}

module.exports = { requireAuth, SESSION_COOKIE, cookieOptions };
