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
function sevenDaysAgoIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString();
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

    console.log(`[reminders] ran for ${dueDate}: ${byUser.size} user(s), ${emailsSent} email(s) sent`);
    res.json({ dueDate, usersWithReminders: byUser.size, emailsSent });
  } catch (e) {
    console.error('send-reminders error', e);
    res.status(500).json({ error: 'Could not send reminders.' });
  }
});

router.post('/send-weekly-recap', requireCronSecret, async (req, res) => {
  try {
    const since = sevenDaysAgoIso();
    const [usersR, completedAsgR, completedTaskR, newGradesR] = await Promise.all([
      pool.query('SELECT id, name, email, current_streak FROM users'),
      pool.query('SELECT user_id, COUNT(*)::int AS n FROM assignments WHERE done = true AND updated_at >= $1 GROUP BY user_id', [since]),
      pool.query('SELECT user_id, COUNT(*)::int AS n FROM study_tasks WHERE done = true AND updated_at >= $1 GROUP BY user_id', [since]),
      pool.query('SELECT user_id, COUNT(*)::int AS n FROM cgpa_entries WHERE created_at >= $1 GROUP BY user_id', [since]),
    ]);

    const asgMap = new Map(completedAsgR.rows.map((r) => [r.user_id, r.n]));
    const taskMap = new Map(completedTaskR.rows.map((r) => [r.user_id, r.n]));
    const gradeMap = new Map(newGradesR.rows.map((r) => [r.user_id, r.n]));

    let emailsSent = 0;
    for (const user of usersR.rows) {
      const completedAssignments = asgMap.get(user.id) || 0;
      const completedTasks = taskMap.get(user.id) || 0;
      const newGrades = gradeMap.get(user.id) || 0;
      const totalCompleted = completedAssignments + completedTasks;

      // Nothing happened this week for this person — skip rather than
      // send a discouraging "you did nothing" email.
      if (totalCompleted === 0 && newGrades === 0) continue;

      await sendEmail({
        to: user.email,
        subject: `Your EduFlow week in review — ${totalCompleted} task${totalCompleted === 1 ? '' : 's'} done`,
        html: `
          <p>Hi ${user.name},</p>
          <p>Here's what you got done on EduFlow this week:</p>
          <ul>
            <li>${completedAssignments} assignment${completedAssignments === 1 ? '' : 's'} completed</li>
            <li>${completedTasks} study task${completedTasks === 1 ? '' : 's'} completed</li>
            ${newGrades ? `<li>${newGrades} new grade${newGrades === 1 ? '' : 's'} logged</li>` : ''}
            ${user.current_streak ? `<li>Current streak: ${user.current_streak} day${user.current_streak === 1 ? '' : 's'}</li>` : ''}
          </ul>
          <p>Keep it up — open EduFlow to see what's next this week.</p>
        `,
      });
      emailsSent += 1;
    }

    console.log(`[weekly-recap] ran: ${emailsSent} email(s) sent`);
    res.json({ emailsSent });
  } catch (e) {
    console.error('send-weekly-recap error', e);
    res.status(500).json({ error: 'Could not send weekly recaps.' });
  }
});

module.exports = router;
