const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT t.*, c.name AS course_name
     FROM timetable t
     JOIN courses c ON c.id = t.course_id
     WHERE t.user_id = $1
     ORDER BY t.day, t.start_time`,
    [req.userId]
  );
  res.json({ timetable: result.rows });
});

router.post('/', async (req, res) => {
  const { courseId, day, start, end, location } = req.body || {};
  if (!courseId || !day || !start || !end) {
    return res.status(400).json({ error: 'Course, day, start and end time are required.' });
  }
  const result = await pool.query(
    'INSERT INTO timetable (user_id, course_id, day, start_time, end_time, location) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.userId, courseId, day, start, end, String(location || '').trim()]
  );
  res.status(201).json({ entry: result.rows[0] });
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM timetable WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

module.exports = router;
