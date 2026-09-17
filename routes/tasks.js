const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const result = await pool.query('SELECT * FROM study_tasks WHERE user_id = $1 ORDER BY created_at', [req.userId]);
  res.json({ tasks: result.rows });
});

router.post('/', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'Task text is required.' });
    const result = await pool.query(
      'INSERT INTO study_tasks (user_id, text) VALUES ($1, $2) RETURNING *',
      [req.userId, String(text).trim()]
    );
    res.status(201).json({ task: result.rows[0] });
  } catch (e) {
    console.error('create task error', e);
    res.status(500).json({ error: 'Could not add task.' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { done } = req.body || {};
    const result = await pool.query(
      'UPDATE study_tasks SET done = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [!!done, req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Task not found.' });
    res.json({ task: result.rows[0] });
  } catch (e) {
    console.error('update task error', e);
    res.status(500).json({ error: 'Could not update task.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM study_tasks WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Task not found.' });
    res.json({ message: 'Task deleted.' });
  } catch (e) {
    console.error('delete task error', e);
    res.status(500).json({ error: 'Could not delete task.' });
  }
});

module.exports = router;
