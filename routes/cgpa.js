const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// This is the only place in the whole app that knows the grade-point
// scale or the classification bands. The frontend only ever receives
// the finished numbers, never this formula.
const GRADE_POINTS = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };
function classify(gpa) {
  if (gpa >= 4.5) return 'First Class';
  if (gpa >= 3.5) return 'Second Class (Upper)';
  if (gpa >= 2.4) return 'Second Class (Lower)';
  if (gpa >= 1.5) return 'Third Class';
  if (gpa >= 1.0) return 'Pass';
  return 'Fail';
}

router.get('/', async (req, res) => {
  const [entriesResult, semestersResult] = await Promise.all([
    pool.query(
      `SELECT ce.id, ce.semester_id, ce.course_id, ce.grade, c.name AS course_name, c.units
       FROM cgpa_entries ce JOIN courses c ON c.id = ce.course_id
       WHERE ce.user_id = $1`,
      [req.userId]
    ),
    pool.query('SELECT id, name FROM semesters WHERE user_id = $1 ORDER BY created_at', [req.userId]),
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
    if (bySemester[entry.semester_id]) {
      bySemester[entry.semester_id].points += points;
      bySemester[entry.semester_id].units += entry.units;
    }
  });

  const semesters = Object.values(bySemester).map((s) => ({
    id: s.id,
    name: s.name,
    units: s.units,
    gpa: s.units ? Number((s.points / s.units).toFixed(2)) : 0,
  }));

  const entriesWithPoints = entries.map((entry) => ({
    ...entry,
    points: GRADE_POINTS[entry.grade] * entry.units,
  }));

  const cumulativeGpa = cumulativeUnits ? Number((cumulativePoints / cumulativeUnits).toFixed(2)) : 0;

  res.json({
    entries: entriesWithPoints,
    semesters,
    cumulative: {
      gpa: cumulativeGpa,
      units: cumulativeUnits,
      classification: cumulativeUnits ? classify(cumulativeGpa) : 'Add grades to calculate',
    },
  });
});

router.post('/', async (req, res) => {
  try {
    const { semesterId, courseId, grade } = req.body || {};
    if (!semesterId || !courseId || !grade) {
      return res.status(400).json({ error: 'Semester, course and grade are required.' });
    }
    if (!GRADE_POINTS.hasOwnProperty(grade)) {
      return res.status(400).json({ error: 'Grade must be one of A, B, C, D, E, F.' });
    }
    const result = await pool.query(
      `INSERT INTO cgpa_entries (user_id, semester_id, course_id, grade)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, semester_id, course_id) DO UPDATE SET grade = EXCLUDED.grade
       RETURNING *`,
      [req.userId, semesterId, courseId, grade]
    );
    res.status(201).json({ entry: result.rows[0] });
  } catch (e) {
    console.error('create cgpa entry error', e);
    res.status(500).json({ error: 'Could not save grade.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM cgpa_entries WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Grade entry not found.' });
    res.json({ message: 'Grade deleted.' });
  } catch (e) {
    console.error('delete cgpa entry error', e);
    res.status(500).json({ error: 'Could not delete grade.' });
  }
});

module.exports = router;
