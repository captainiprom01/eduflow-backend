const express = require('express');
const { pool } = require('../db');
const { sendEmail } = require('../lib/email');

const router = express.Router();

// Not user-authenticated — this is meant to be called by a scheduled job
// (see .github/workflows/reminders.yml), not a logged-in person. Protected
// by a shared secret instead of a login token.
function requireCronSecret(req, res, next) {
  const provided = req.query.key || req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET) {
    return res.status(501).json({ error: 'CRON_SECRET is not configured on this server.' });
  }
  if (provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing cron key.' });
  }
  next();
}

function tomorrowDateString() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

router.post('/send-reminders', requireCronSecret, async (req, res) => {
  try {
    const dueDate = tomorrowDateString();
    const result = await pool.query(
      `SELECT a.title, u.id AS user_id, u.name AS user_name, u.email AS user_email, c.name AS course_name
       FROM assignments a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN courses c ON c.id = a.course_id
       WHERE a.done = false AND a.due_date = $1`,
      [dueDate]
    );

    const byUser = new Map();
    for (const row of result.rows) {
      if (!byUser.has(row.user_id)) {
        byUser.set(row.user_id, { name: row.user_name, email: row.user_email, items: [] });
      }
      byUser.get(row.user_id).items.push({ title: row.title, course: row.course_name });
    }

    let emailsSent = 0;
    for (const { name, email, items } of byUser.values()) {
      const listHtml = items
        .map((i) => `<li>${i.title}${i.course ? ` — ${i.course}` : ''}</li>`)
        .join('');
      await sendEmail({
        to: email,
        subject: `You have ${items.length} assignment${items.length === 1 ? '' : 's'} due tomorrow`,
        html: `
          <p>Hi ${name},</p>
          <p>This is a heads-up that you have ${items.length} assignment${items.length === 1 ? '' : 's'} due tomorrow (${dueDate}):</p>
          <ul>${listHtml}</ul>
          <p>Open EduFlow to check them off as you go.</p>
        `,
      });
      emailsSent += 1;
    }

    res.json({ dueDate, usersWithReminders: byUser.size, emailsSent });
  } catch (e) {
    console.error('send-reminders error', e);
    res.status(500).json({ error: 'Could not send reminders.' });
  }
});

module.exports = router;
