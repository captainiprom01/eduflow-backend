const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM semesters WHERE user_id = $1 ORDER BY created_at',
    [req.userId]
  );
  res.json({ semesters: result.rows });
});

router.post('/', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Semester name is required.' });
  }
  const result = await pool.query(
    'INSERT INTO semesters (user_id, name) VALUES ($1,$2) RETURNING *',
    [req.userId, String(name).trim()]
  );
  res.status(201).json({ semester: result.rows[0] });
});

router.delete('/:id', async (req, res) => {
  // ON DELETE CASCADE on cgpa_entries.semester_id removes that semester's
  // grades automatically.
  await pool.query('DELETE FROM semesters WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

module.exports = router;
