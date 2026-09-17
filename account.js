const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendEmail } = require('../lib/email');

const router = express.Router();
router.use(requireAuth);

const USER_FIELDS = 'id, name, email, (password_hash IS NOT NULL) AS has_password, email_verified';

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function sendVerificationEmail(userId, toEmail) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query('UPDATE users SET verify_token_hash = $1, verify_token_expires = $2 WHERE id = $3', [
    hashToken(rawToken),
    expires,
    userId,
  ]);
  const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const verifyLink = `${frontendUrl}?verifyToken=${rawToken}`;
  await sendEmail({
    to: toEmail,
    subject: 'Verify your new EduFlow email',
    html: `
      <p>You changed the email on your EduFlow account. Please confirm this new address.</p>
      <p><a href="${verifyLink}">Click here to verify your email</a>. This link expires in 24 hours.</p>
      <p>If you didn't make this change, please secure your account immediately.</p>
    `,
  });
}

router.patch('/profile', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required.' });
    const result = await pool.query(
      `UPDATE users SET name = $1 WHERE id = $2 RETURNING ${USER_FIELDS}`,
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

    const current = await pool.query('SELECT email, password_hash FROM users WHERE id = $1', [req.userId]);
    const { email: oldEmail, password_hash: passwordHash } = current.rows[0];
    if (passwordHash) {
      if (!currentPassword) return res.status(400).json({ error: 'Enter your current password to change your email.' });
      const match = await bcrypt.compare(String(currentPassword), passwordHash);
      if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    if (normalizedEmail === oldEmail) {
      const unchanged = await pool.query(`SELECT ${USER_FIELDS} FROM users WHERE id = $1`, [req.userId]);
      return res.json({ user: unchanged.rows[0] });
    }

    const taken = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [normalizedEmail, req.userId]);
    if (taken.rows.length) return res.status(409).json({ error: 'That email is already in use by another account.' });

    // A changed email hasn't been proven to belong to this person yet —
    // mark it unverified and send a fresh verification link to it.
    const result = await pool.query(
      `UPDATE users SET email = $1, email_verified = false WHERE id = $2 RETURNING ${USER_FIELDS}`,
      [normalizedEmail, req.userId]
    );
    sendVerificationEmail(req.userId, normalizedEmail).catch((e) => console.error('verification email failed', e));
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

router.get('/export', async (req, res) => {
  try {
    const userId = req.userId;
    const [userR, coursesR, semestersR, cgpaR, timetableR, assignmentsR, tasksR] = await Promise.all([
      pool.query('SELECT name, email, created_at FROM users WHERE id = $1', [userId]),
      pool.query('SELECT id, name, code, units, instructor, created_at FROM courses WHERE user_id = $1', [userId]),
      pool.query('SELECT id, name, created_at FROM semesters WHERE user_id = $1', [userId]),
      pool.query(
        `SELECT ce.grade, ce.created_at, s.name AS semester_name, c.name AS course_name, c.units
         FROM cgpa_entries ce
         JOIN semesters s ON s.id = ce.semester_id
         JOIN courses c ON c.id = ce.course_id
         WHERE ce.user_id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT t.day, t.start_time, t.end_time, t.location, c.name AS course_name
         FROM timetable t JOIN courses c ON c.id = t.course_id WHERE t.user_id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT a.title, a.due_date, a.priority, a.done, c.name AS course_name
         FROM assignments a LEFT JOIN courses c ON c.id = a.course_id WHERE a.user_id = $1`,
        [userId]
      ),
      pool.query('SELECT text, done, created_at FROM study_tasks WHERE user_id = $1', [userId]),
    ]);

    res.json({
      exportedAt: new Date().toISOString(),
      account: userR.rows[0],
      courses: coursesR.rows,
      semesters: semestersR.rows,
      grades: cgpaR.rows,
      timetable: timetableR.rows,
      assignments: assignmentsR.rows,
      studyTasks: tasksR.rows,
    });
  } catch (e) {
    console.error('export data error', e);
    res.status(500).json({ error: 'Could not export your data.' });
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
