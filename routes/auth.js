const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendEmail } = require('../lib/email');
const { authLimiter } = require('../middleware/rateLimit');

const router = express.Router();
const googleClient = process.env.GOOGLE_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID) : null;
const USER_FIELDS = 'id, name, email, (password_hash IS NOT NULL) AS has_password, email_verified';

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// Hash a raw token before storing/looking it up, so a database leak alone
// never exposes a usable reset/verification link (same idea as hashing
// passwords).
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
function frontendUrl() {
  return (process.env.FRONTEND_URL || '').replace(/\/$/, '');
}

async function sendVerificationEmail(userId, toEmail) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  await pool.query('UPDATE users SET verify_token_hash = $1, verify_token_expires = $2 WHERE id = $3', [
    hashToken(rawToken),
    expires,
    userId,
  ]);
  const verifyLink = `${frontendUrl()}?verifyToken=${rawToken}`;
  await sendEmail({
    to: toEmail,
    subject: 'Verify your EduFlow email',
    html: `
      <p>Welcome to EduFlow! Please confirm this is your email address.</p>
      <p><a href="${verifyLink}">Click here to verify your email</a>. This link expires in 24 hours.</p>
      <p>If you didn't create an EduFlow account, you can ignore this email.</p>
    `,
  });
}

router.post('/signup', authLimiter, async (req, res) => {
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
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING ${USER_FIELDS}`,
      [String(name).trim(), normalizedEmail, hash]
    );
    const user = result.rows[0];
    sendVerificationEmail(user.id, normalizedEmail).catch((e) => console.error('verification email failed', e));
    res.status(201).json({ token: signToken(user.id), user });
  } catch (e) {
    console.error('signup error', e);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
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
    res.json({
      token: signToken(user.id),
      user: { id: user.id, name: user.name, email: user.email, has_password: true, email_verified: user.email_verified },
    });
  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ error: 'Could not log in.' });
  }
});

router.post('/google', authLimiter, async (req, res) => {
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

    let result = await pool.query(`SELECT ${USER_FIELDS} FROM users WHERE google_id = $1`, [googleId]);
    let user = result.rows[0];

    if (!user) {
      // No account linked to this Google ID yet — check if the email is
      // already registered (e.g. they originally signed up with a
      // password) and link it, otherwise create a brand new account.
      // Google has already confirmed this email address, so either way
      // the account is marked verified — no separate email to send.
      result = await pool.query(`SELECT ${USER_FIELDS} FROM users WHERE email = $1`, [normalizedEmail]);
      user = result.rows[0];
      if (user) {
        await pool.query('UPDATE users SET google_id = $1, email_verified = true WHERE id = $2', [googleId, user.id]);
        user.email_verified = true;
      } else {
        const inserted = await pool.query(
          `INSERT INTO users (name, email, google_id, email_verified) VALUES ($1, $2, $3, true) RETURNING ${USER_FIELDS}`,
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

router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Missing verification token.' });
    const result = await pool.query(
      'SELECT id FROM users WHERE verify_token_hash = $1 AND verify_token_expires > now()',
      [hashToken(token)]
    );
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: 'This verification link is invalid or has expired. Request a new one from Account settings.' });
    await pool.query(
      'UPDATE users SET email_verified = true, verify_token_hash = NULL, verify_token_expires = NULL WHERE id = $1',
      [user.id]
    );
    res.json({ message: 'Email verified. Thanks!' });
  } catch (e) {
    console.error('verify-email error', e);
    res.status(500).json({ error: 'Could not verify your email.' });
  }
});

router.post('/resend-verification', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT email, email_verified FROM users WHERE id = $1', [req.userId]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (user.email_verified) return res.json({ message: 'Your email is already verified.' });
    await sendVerificationEmail(req.userId, user.email);
    res.json({ message: 'Verification email sent — check your inbox.' });
  } catch (e) {
    console.error('resend-verification error', e);
    res.status(500).json({ error: 'Could not send verification email.' });
  }
});

router.post('/forgot-password', authLimiter, async (req, res) => {
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

    const resetLink = `${frontendUrl()}?resetToken=${rawToken}`;
    await sendEmail({
      to: normalizedEmail,
      subject: 'Reset your EduFlow password',
      html: `
        <p>Someone asked to reset the password on your EduFlow account.</p>
        <p><a href="${resetLink}">Click here to set a new password</a>. This link expires in 1 hour.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
    });

    res.json(genericMessage);
  } catch (e) {
    console.error('forgot-password error', e);
    // Still return the generic message — don't leak that something broke
    // server-side to a potential attacker probing for valid emails.
    res.json(genericMessage);
  }
});

router.post('/reset-password', authLimiter, async (req, res) => {
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
  const result = await pool.query(`SELECT ${USER_FIELDS} FROM users WHERE id = $1`, [req.userId]);
  if (!result.rows.length) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: result.rows[0] });
});

module.exports = router;
