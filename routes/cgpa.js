const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// This is the logic that used to live in the frontend JS, where anyone could
// read it via view-source. It now only exists here, on the server.
const GRADE_POINTS = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };

function classify(gpa) {
  if (gpa >= 4.5) return 'First Class';
  if (gpa >= 3.5) return 'Second Class (Upper)';
  if (gpa >= 2.4) return 'Second Class (Lower)';
  if (gpa >= 1.5) return 'Third Class';
  if (gpa >= 1.0) return 'Pass';
  return 'Add grades to calculate';
}

// GET /api/cgpa - every grade entry plus computed per-semester GPA and
// cumulative CGPA. The frontend only ever renders these numbers; it never
// computes them.
router.get('/', async (req, res) => {
  const [entriesResult, semestersResult] = await Promise.all([
    pool.query(
      `SELECT ce.id, ce.semester_id, ce.course_id, ce.grade, c.name AS course_name, c.units
       FROM cgpa_entries ce
       JOIN courses c ON c.id = ce.course_id
       WHERE ce.user_id = $1
       ORDER BY ce.created_at`,
      [req.userId]
    ),
    pool.query('SELECT * FROM semesters WHERE user_id = $1 ORDER BY created_at', [req.userId]),
  ]);

  const entries = entriesResult.rows;
  const bySemester = {};
  semestersResult.rows.forEach((s) => {
    bySemester[s.id] = { id: s.id, name: s.name, points: 0, units: 0 };
  });

  let cumulativePoints = 0;
  let cumulativeUnits = 0;
  entries.forEach((entry) => {
    const points = GRADE_POINTS[entry.grade] * entry.units;
    cumulativePoints += points;
    cumulativeUnits += entry.units;
    const bucket = bySemester[entry.semester_id];
    if (bucket) {
      bucket.points += points;
      bucket.units += entry.units;
    }
  });

  const semesters = Object.values(bySemester).map((s) => ({
    id: s.id,
    name: s.name,
    units: s.units,
    gpa: s.units ? Number((s.points / s.units).toFixed(2)) : 0,
  }));

  const cumulativeGpa = cumulativeUnits ? Number((cumulativePoints / cumulativeUnits).toFixed(2)) : 0;

  res.json({
    entries,
    semesters,
    cumulative: {
      gpa: cumulativeGpa,
      units: cumulativeUnits,
      classification: cumulativeUnits ? classify(cumulativeGpa) : 'Add grades to calculate',
    },
  });
});

router.post('/', async (req, res) => {
  const { semesterId, courseId, grade } = req.body || {};
  if (!semesterId || !courseId || !Object.prototype.hasOwnProperty.call(GRADE_POINTS, grade)) {
    return res.status(400).json({ error: 'Semester, course and a valid grade are required.' });
  }
  // One grade per course per semester - replace any existing entry.
  await pool.query(
    'DELETE FROM cgpa_entries WHERE semester_id = $1 AND course_id = $2 AND user_id = $3',
    [semesterId, courseId, req.userId]
  );
  const result = await pool.query(
    'INSERT INTO cgpa_entries (user_id, semester_id, course_id, grade) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.userId, semesterId, courseId, grade]
  );
  res.status(201).json({ entry: result.rows[0] });
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM cgpa_entries WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

module.exports = router;
