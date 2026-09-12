const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.patch('/profile', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required.' });
    const result = await pool.query(
      'UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name, email, (password_hash IS NOT NULL) AS has_password',
      [String(name).trim(), req.userId]
    );
    res.json({ user: result.rows[0] });
  } catch (e) {
    console.error('update profile error', e);
    res.status(500).json({ error: 'Could not update your name.' });
  }
});

router.patch('/email', async (req, res) => {
  try {
    const { newEmail, currentPassword } = req.body || {};
    if (!newEmail) return res.status(400).json({ error: 'A new email is required.' });
    const normalizedEmail = String(newEmail).trim().toLowerCase();

    const current = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
    const passwordHash = current.rows[0].password_hash;
    if (passwordHash) {
      if (!currentPassword) return res.status(400).json({ error: 'Enter your current password to change your email.' });
      const match = await bcrypt.compare(String(currentPassword), passwordHash);
      if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const taken = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [normalizedEmail, req.userId]);
    if (taken.rows.length) return res.status(409).json({ error: 'That email is already in use by another account.' });

    const result = await pool.query(
      'UPDATE users SET email = $1 WHERE id = $2 RETURNING id, name, email, (password_hash IS NOT NULL) AS has_password',
      [normalizedEmail, req.userId]
    );
    res.json({ user: result.rows[0] });
  } catch (e) {
    console.error('update email error', e);
    res.status(500).json({ error: 'Could not update your email.' });
  }
});

router.patch('/password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    const current = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
    const passwordHash = current.rows[0].password_hash;

    // Accounts created via Google have no password yet — let them set one
    // for the first time without needing a "current" password that never
    // existed. Anyone who already has a password must confirm it first.
    if (passwordHash) {
      if (!currentPassword) return res.status(400).json({ error: 'Enter your current password.' });
      const match = await bcrypt.compare(String(currentPassword), passwordHash);
      if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(String(newPassword), 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.userId]);
    res.json({ message: passwordHash ? 'Password updated.' : 'Password set. You can now also log in with your email and this password.' });
  } catch (e) {
    console.error('update password error', e);
    res.status(500).json({ error: 'Could not update your password.' });
  }
});

router.delete('/', async (req, res) => {
  try {
    const { currentPassword } = req.body || {};
    const current = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
    const passwordHash = current.rows[0].password_hash;
    if (passwordHash) {
      if (!currentPassword) return res.status(400).json({ error: 'Enter your password to confirm account deletion.' });
      const match = await bcrypt.compare(String(currentPassword), passwordHash);
      if (!match) return res.status(401).json({ error: 'Password is incorrect.' });
    }
    // Every other table references users(id) ON DELETE CASCADE, so this
    // single delete also removes all of this account's courses, semesters,
    // grades, timetable entries, assignments and study tasks.
    await pool.query('DELETE FROM users WHERE id = $1', [req.userId]);
    res.json({ message: 'Account deleted.' });
  } catch (e) {
    console.error('delete account error', e);
    res.status(500).json({ error: 'Could not delete your account.' });
  }
});

module.exports = router;
