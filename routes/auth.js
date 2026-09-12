const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const googleClient = process.env.GOOGLE_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID) : null;

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// Hash a raw token before storing/looking it up, so a database leak alone
// never exposes a usable reset link (same idea as hashing passwords).
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function sendResetEmail(toEmail, resetLink) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping actual email send. Reset link:', resetLink);
    return;
  }
  const from = process.env.RESET_EMAIL_FROM || 'EduFlow <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [toEmail],
      subject: 'Reset your EduFlow password',
      html: `
        <p>Someone asked to reset the password on your EduFlow account.</p>
        <p><a href="${resetLink}">Click here to set a new password</a>. This link expires in 1 hour.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('Resend send failed', res.status, body);
  }
}

router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }
    const hash = await bcrypt.hash(String(password), 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, (password_hash IS NOT NULL) AS has_password',
      [String(name).trim(), normalizedEmail, hash]
    );
    const user = result.rows[0];
    res.status(201).json({ token: signToken(user.id), user });
  } catch (e) {
    console.error('signup error', e);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const normalizedEmail = String(email).trim().toLowerCase();
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account was created with Google. Use "Continue with Google" to sign in.' });
    }
    const match = await bcrypt.compare(String(password), user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });
    res.json({ token: signToken(user.id), user: { id: user.id, name: user.name, email: user.email, has_password: true } });
  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ error: 'Could not log in.' });
  }
});

router.post('/google', async (req, res) => {
  try {
    if (!googleClient) {
      return res.status(501).json({ error: 'Google sign-in is not configured on this server yet.' });
    }
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Missing Google credential.' });

    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const normalizedEmail = String(payload.email).trim().toLowerCase();
    const googleId = payload.sub;
    const name = payload.name || normalizedEmail.split('@')[0];

    let result = await pool.query('SELECT id, name, email, (password_hash IS NOT NULL) AS has_password FROM users WHERE google_id = $1', [googleId]);
    let user = result.rows[0];

    if (!user) {
      // No account linked to this Google ID yet — check if the email is
      // already registered (e.g. they originally signed up with a
      // password) and link it, otherwise create a brand new account.
      result = await pool.query('SELECT id, name, email, (password_hash IS NOT NULL) AS has_password FROM users WHERE email = $1', [normalizedEmail]);
      user = result.rows[0];
      if (user) {
        await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, user.id]);
      } else {
        const inserted = await pool.query(
          'INSERT INTO users (name, email, google_id) VALUES ($1, $2, $3) RETURNING id, name, email, (password_hash IS NOT NULL) AS has_password',
          [name, normalizedEmail, googleId]
        );
        user = inserted.rows[0];
      }
    }

    res.json({ token: signToken(user.id), user });
  } catch (e) {
    console.error('google sign-in error', e);
    res.status(401).json({ error: 'Could not verify Google sign-in.' });
  }
});

router.post('/forgot-password', async (req, res) => {
  const genericMessage = { message: "If that email is registered, we've sent a reset link to it." };
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    const normalizedEmail = String(email).trim().toLowerCase();
    const result = await pool.query('SELECT id, password_hash FROM users WHERE email = $1', [normalizedEmail]);
    const user = result.rows[0];

    // Always respond the same way whether or not the account exists, so a
    // stranger can't use this endpoint to check who has an EduFlow account.
    if (!user || !user.password_hash) {
      return res.json(genericMessage);
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await pool.query(
      'UPDATE users SET reset_token_hash = $1, reset_token_expires = $2 WHERE id = $3',
      [hashToken(rawToken), expires, user.id]
    );

    const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    const resetLink = `${frontendUrl}?resetToken=${rawToken}`;
    await sendResetEmail(normalizedEmail, resetLink);

    res.json(genericMessage);
  } catch (e) {
    console.error('forgot-password error', e);
    // Still return the generic message — don't leak that something broke
    // server-side to a potential attacker probing for valid emails.
    res.json(genericMessage);
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ error: 'Reset token and new password are required.' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const result = await pool.query(
      'SELECT id FROM users WHERE reset_token_hash = $1 AND reset_token_expires > now()',
      [hashToken(token)]
    );
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });

    const hash = await bcrypt.hash(String(password), 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = $2',
      [hash, user.id]
    );
    res.json({ message: 'Password updated. You can now log in with your new password.' });
  } catch (e) {
    console.error('reset-password error', e);
    res.status(500).json({ error: 'Could not reset password.' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT id, name, email, (password_hash IS NOT NULL) AS has_password FROM users WHERE id = $1', [req.userId]);
  if (!result.rows.length) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: result.rows[0] });
});

module.exports = router;
