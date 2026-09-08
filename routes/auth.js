const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
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
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
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
    const match = await bcrypt.compare(String(password), user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });
    res.json({ token: signToken(user.id), user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ error: 'Could not log in.' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [req.userId]);
  if (!result.rows.length) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: result.rows[0] });
});

module.exports = router;
