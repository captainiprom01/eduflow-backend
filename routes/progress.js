const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const [assignments, tasks] = await Promise.all([
    pool.query('SELECT done, due_date FROM assignments WHERE user_id = $1', [req.userId]),
    pool.query('SELECT done FROM study_tasks WHERE user_id = $1', [req.userId]),
  ]);

  const totalItems = assignments.rows.length + tasks.rows.length;
  const doneItems =
    assignments.rows.filter((a) => a.done).length + tasks.rows.filter((t) => t.done).length;

  const todayStr = new Date().toISOString().slice(0, 10);
  const overdue = assignments.rows.filter((a) => !a.done && a.due_date < todayStr).length;

  const percent = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;

  res.json({ totalItems, doneItems, overdue, percent });
});

module.exports = router;
