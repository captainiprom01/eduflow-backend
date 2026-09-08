const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM courses WHERE user_id = $1 ORDER BY created_at',
    [req.userId]
  );
  res.json({ courses: result.rows });
});

router.post('/', async (req, res) => {
  const { name, code, units, instructor } = req.body || {};
  const parsedUnits = parseInt(units, 10);
  if (!name || !parsedUnits) {
    return res.status(400).json({ error: 'Course title and units are required.' });
  }
  const result = await pool.query(
    'INSERT INTO courses (user_id, name, code, units, instructor) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.userId, String(name).trim(), String(code || '').trim(), parsedUnits, String(instructor || '').trim()]
  );
  res.status(201).json({ course: result.rows[0] });
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM courses WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

module.exports = router;
