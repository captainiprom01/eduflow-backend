const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT t.*, c.name AS course_name
     FROM timetable t JOIN courses c ON c.id = t.course_id
     WHERE t.user_id = $1
     ORDER BY t.day, t.start_time`,
    [req.userId]
  );
  res.json({ timetable: result.rows });
});

router.post('/', async (req, res) => {
  try {
    const { courseId, day, startTime, endTime, location } = req.body || {};
    if (!courseId || !day || !startTime || !endTime) {
      return res.status(400).json({ error: 'Course, day, start time and end time are required.' });
    }
    const result = await pool.query(
      'INSERT INTO timetable (user_id, course_id, day, start_time, end_time, location) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.userId, courseId, day, startTime, endTime, location ? String(location).trim() : null]
    );
    res.status(201).json({ entry: result.rows[0] });
  } catch (e) {
    console.error('create timetable entry error', e);
    res.status(500).json({ error: 'Could not add class.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM timetable WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Class not found.' });
    res.json({ message: 'Class deleted.' });
  } catch (e) {
    console.error('delete timetable entry error', e);
    res.status(500).json({ error: 'Could not delete class.' });
  }
});

module.exports = router;
