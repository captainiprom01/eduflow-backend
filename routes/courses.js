const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const result = await pool.query('SELECT * FROM courses WHERE user_id = $1 ORDER BY created_at', [req.userId]);
  res.json({ courses: result.rows });
});

router.post('/', async (req, res) => {
  try {
    const { name, code, units, instructor } = req.body || {};
    if (!name || !units) return res.status(400).json({ error: 'Course name and units are required.' });
    const result = await pool.query(
      'INSERT INTO courses (user_id, name, code, units, instructor) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.userId, String(name).trim(), code ? String(code).trim() : null, parseInt(units, 10), instructor ? String(instructor).trim() : null]
    );
    res.status(201).json({ course: result.rows[0] });
  } catch (e) {
    console.error('create course error', e);
    res.status(500).json({ error: 'Could not create course.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM courses WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Course not found.' });
    res.json({ message: 'Course deleted.' });
  } catch (e) {
    console.error('delete course error', e);
    res.status(500).json({ error: 'Could not delete course.' });
  }
});

module.exports = router;
