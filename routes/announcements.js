const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { parsePagination, paginationMeta } = require('../middleware/pagination');

const router = express.Router();
router.use(requireAuth);

const DEFAULT_ANNOUNCEMENTS = [
  { category: 'Academic', title: 'Examination timetable updates', body: 'Check the latest examination schedule and confirm your courses before the registration deadline.', author: 'Examinations Office', icon: 'fa-calendar-days', color: '#2563eb', bg: '#eff6ff' },
  { category: 'Campus', title: 'Extended library opening hours', body: 'The main library will remain open later during the revision period to support students preparing for assessments.', author: 'University Library', icon: 'fa-building-columns', color: '#059669', bg: '#ecfdf5' },
  { category: 'Events', title: 'EduFlow study skills workshop', body: 'Join this week’s practical session on planning a study week, managing deadlines, and using EduAI effectively.', author: 'Student Success Team', icon: 'fa-lightbulb', color: '#7c3aed', bg: '#f5f3ff' },
  { category: 'Campus', title: 'Student support services available', body: 'Academic advising, counselling, and accessibility support remain available through the student services centre.', author: 'Student Affairs', icon: 'fa-heart', color: '#db2777', bg: '#fdf2f8' },
];

function clean(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}
async function isPublisher(req) {
  const emails = String(process.env.ANNOUNCEMENT_ADMIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) return false;
  const result = await pool.query('SELECT email FROM users WHERE id = $1', [req.userId]);
  return emails.includes(String(result.rows[0] && result.rows[0].email || '').toLowerCase());
}

router.get('/', async (req, res) => {
  try {
    const { page, pageSize, offset } = parsePagination(req.query);
    const [countResult, result] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS total FROM announcements WHERE published = true'),
      pool.query(
      `SELECT a.id, a.category, a.title, a.body, a.author, a.icon, a.color, a.bg,
              a.published_at, (ar.user_id IS NOT NULL) AS read
       FROM announcements a
       LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.user_id = $1
       WHERE a.published = true
       ORDER BY a.published_at DESC, a.id DESC
       LIMIT $2 OFFSET $3`,
      [req.userId, pageSize, offset]
      ),
    ]);
    res.json({ announcements: result.rows, pagination: paginationMeta(page, pageSize, countResult.rows[0].total) });
  } catch (e) {
    console.error('list announcements error', e);
    res.status(500).json({ error: 'Could not load announcements.' });
  }
});

router.post('/:id/read', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid announcement.' });
    await pool.query(
      `INSERT INTO announcement_reads (announcement_id, user_id) VALUES ($1, $2)
       ON CONFLICT (announcement_id, user_id) DO NOTHING`,
      [id, req.userId]
    );
    res.json({ read: true });
  } catch (e) {
    console.error('mark announcement read error', e);
    res.status(500).json({ error: 'Could not mark announcement as read.' });
  }
});

router.post('/', async (req, res) => {
  try {
    if (!(await isPublisher(req))) return res.status(403).json({ error: 'Announcement publishing is restricted.' });
    const { category, title, body, author, icon, color, bg } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: 'Title and body are required.' });
    const result = await pool.query(
      `INSERT INTO announcements (category, title, body, author, icon, color, bg)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [clean(category, 40) || 'Campus', clean(title, 160), clean(body), clean(author, 100) || 'EduFlow', clean(icon, 80) || 'fa-bullhorn', clean(color, 20) || '#2563eb', clean(bg, 40) || '#eff6ff']
    );
    res.status(201).json({ announcement: result.rows[0] });
  } catch (e) {
    console.error('publish announcement error', e);
    res.status(500).json({ error: 'Could not publish announcement.' });
  }
});

module.exports = { router, DEFAULT_ANNOUNCEMENTS };
