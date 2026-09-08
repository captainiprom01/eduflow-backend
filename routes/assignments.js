const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT a.*, c.name AS course_name
     FROM assignments a
     LEFT JOIN courses c ON c.id = a.course_id
     WHERE a.user_id = $1
     ORDER BY a.due_date`,
    [req.userId]
  );
  res.json({ assignments: result.rows });
});

router.post('/', async (req, res) => {
  const { title, courseId, due, priority } = req.body || {};
  if (!title || !due) return res.status(400).json({ error: 'Title and due date are required.' });
  const result = await pool.query(
    'INSERT INTO assignments (user_id, course_id, title, due_date, priority) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.userId, courseId || null, String(title).trim(), due, priority === 'high' ? 'high' : 'normal']
  );
  res.status(201).json({ assignment: result.rows[0] });
});

router.patch('/:id', async (req, res) => {
  const { done } = req.body || {};
  const result = await pool.query(
    'UPDATE assignments SET done = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
    [!!done, req.params.id, req.userId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Assignment not found.' });
  res.json({ assignment: result.rows[0] });
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM assignments WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

module.exports = router;
