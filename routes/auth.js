const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { pool } = require('../db');
const { requireAuth, SESSION_COOKIE } = require('../middleware/auth');
const { sendEmail } = require('../lib/email');
const { authLimiter } = require('../middleware/rateLimit');
const { validate } = require('../middleware/validate');
const { z } = require('zod');

const router = express.Router();
const googleClient = process.env.GOOGLE_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID) : null;
const USER_FIELDS = 'id, name, email, school, department, programme, level, (password_hash IS NOT NULL) AS has_password, email_verified';
const signupSchema = z.object({ name: z.string().trim().min(1).max(160), email: z.string().email().max(320), password: z.string().min(8).max(200) });
const loginSchema = z.object({ email: z.string().email().max(320), password: z.string().min(1).max(200) });
const googleSchema = z.object({ credential: z.string().min(1).max(10000) });

function signToken(userId) {
  const sessionId = crypto.randomUUID();
  return { sessionId, token: jwt.sign({ userId, jti: sessionId }, process.env.JWT_SECRET, { expiresIn: '30d', algorithm: 'HS256' }) };
}

function setSessionCookie(res, token) {
  const sameSite = process.env.SESSION_COOKIE_SAMESITE || 'lax';
  const secure = process.env.NODE_ENV === 'production';
  // HttpOnly prevents JavaScript from reading the credential. SameSite and the
  // Origin check in realtime.js reduce cross-site WebSocket abuse.
  res.append('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=${sameSite}; Path=/; Max-Age=${30 * 24 * 60 * 60}`);
}

async function issueSession(res, userId) {
  const { sessionId, token } = signToken(userId);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await pool.query('INSERT INTO user_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)', [sessionId, userId, hashToken(sessionId), expiresAt]);
  setSessionCookie(res, token);
  return token;
}

// Existing API clients still receive token; new clients should rely on the cookie.
// eslint-disable-next-line no-unused-vars
function sessionResponse(res, token) { return token; }

function hashToken(rawToken) { return crypto.createHash('sha256').update(rawToken).digest('hex'); }
function frontendUrl() { return (process.env.FRONTEND_URL || '').replace(/\/$/, ''); }

async function sendVerificationEmail(userId, toEmail) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query('UPDATE users SET verify_token_hash = $1, verify_token_expires = $2 WHERE id = $3', [hashToken(rawToken), expires, userId]);
  await sendEmail({ to: toEmail, subject: 'Verify your EduFlow email', html: `<p>Welcome to EduFlow! Please confirm this is your email address.</p><p><a href="${frontendUrl()}?verifyToken=${rawToken}">Click here to verify your email</a>. This link expires in 24 hours.</p>` });
}

router.post('/signup', authLimiter, validate(signupSchema), async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const normalizedEmail = String(email).trim().toLowerCase();
    if ((await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail])).rowCount) return res.status(409).json({ error: 'An account with that email already exists.' });
    const hash = await bcrypt.hash(String(password), 10);
    const result = await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING ${USER_FIELDS}`, [String(name).trim(), normalizedEmail, hash]);
    const user = result.rows[0];
    sendVerificationEmail(user.id, normalizedEmail).catch((e) => console.error('verification email failed', e));
    const token = await issueSession(res, user.id);
    res.status(201).json({ token, user });
  } catch (e) { console.error('signup error', e); res.status(500).json({ error: 'Could not create account.' }); }
});

router.post('/login', authLimiter, validate(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [String(email).trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user || !user.password_hash || !(await bcrypt.compare(String(password), user.password_hash))) return res.status(401).json({ error: 'Invalid email or password.' });
    const token = await issueSession(res, user.id);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, has_password: true, email_verified: user.email_verified } });
  } catch (e) { console.error('login error', e); res.status(500).json({ error: 'Could not log in.' }); }
});

router.post('/google', authLimiter, validate(googleSchema), async (req, res) => {
  try {
    if (!googleClient) return res.status(501).json({ error: 'Google sign-in is not configured on this server yet.' });
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Missing Google credential.' });
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const normalizedEmail = String(payload.email).trim().toLowerCase();
    let result = await pool.query(`SELECT ${USER_FIELDS} FROM users WHERE google_id = $1`, [payload.sub]);
    let user = result.rows[0];
    if (!user) {
      result = await pool.query(`SELECT ${USER_FIELDS} FROM users WHERE email = $1`, [normalizedEmail]);
      user = result.rows[0];
      if (user) await pool.query('UPDATE users SET google_id = $1, email_verified = true WHERE id = $2', [payload.sub, user.id]);
      else user = (await pool.query(`INSERT INTO users (name, email, google_id, email_verified) VALUES ($1, $2, $3, true) RETURNING ${USER_FIELDS}`, [payload.name || normalizedEmail.split('@')[0], normalizedEmail, payload.sub])).rows[0];
    }
    const token = await issueSession(res, user.id);
    res.json({ token, user });
  } catch (e) { console.error('google sign-in error', e); res.status(401).json({ error: 'Could not verify Google sign-in.' }); }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT ${USER_FIELDS} FROM users WHERE id = $1`, [req.userId]);
    if (!result.rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: result.rows[0] });
  } catch (e) {
    console.error('get current user error', e);
    res.status(500).json({ error: 'Could not load your account.' });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  try {
    await pool.query('UPDATE user_sessions SET revoked_at = now() WHERE id = $1', [req.sessionId]);
    res.append('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}SameSite=${process.env.SESSION_COOKIE_SAMESITE || 'lax'}; Path=/; Max-Age=0`);
    res.json({ loggedOut: true });
  } catch (e) {
    console.error('logout error', e);
    res.status(500).json({ error: 'Could not log out.' });
  }
});

module.exports = router;
