const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const GRADE_POINTS = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };
function classify(gpa) {
  if (gpa >= 4.5) return 'First Class';
  if (gpa >= 3.5) return 'Second Class (Upper)';
  if (gpa >= 2.4) return 'Second Class (Lower)';
  if (gpa >= 1.5) return 'Third Class';
  return 'Pass';
}

// Pulled fresh from the database on every message rather than trusting
// whatever the frontend has cached, so the AI is always reasoning over
// the student's actual current data.
async function buildContext(userId) {
  const [coursesR, assignmentsR, timetableR, cgpaR] = await Promise.all([
    pool.query('SELECT name, units FROM courses WHERE user_id = $1', [userId]),
    pool.query('SELECT title, due_date, done FROM assignments WHERE user_id = $1 ORDER BY due_date', [userId]),
    pool.query(
      `SELECT t.day, t.start_time, t.end_time, c.name AS course_name
       FROM timetable t JOIN courses c ON c.id = t.course_id
       WHERE t.user_id = $1`,
      [userId]
    ),
    pool.query(
      `SELECT ce.grade, c.units FROM cgpa_entries ce JOIN courses c ON c.id = ce.course_id WHERE ce.user_id = $1`,
      [userId]
    ),
  ]);

  let points = 0;
  let units = 0;
  cgpaR.rows.forEach((r) => {
    points += GRADE_POINTS[r.grade] * r.units;
    units += r.units;
  });
  const cgpa = units ? points / units : null;

  const todayStr = new Date().toISOString().slice(0, 10);
  const pending = assignmentsR.rows.filter((a) => !a.done);
  const overdue = pending.filter((a) => a.due_date < todayStr);

  return {
    courseCount: coursesR.rows.length,
    cumulativeCgpa: cgpa ? Number(cgpa.toFixed(2)) : null,
    cgpaClassification: cgpa ? classify(cgpa) : null,
    unitsLogged: units,
    pendingAssignments: pending.map((a) => ({ title: a.title, dueDate: a.due_date })),
    overdueAssignmentCount: overdue.length,
    weeklyTimetable: timetableR.rows.map((t) => ({ day: t.day, start: t.start_time, end: t.end_time, course: t.course_name })),
  };
}

router.post('/chat', async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    // No key configured — tell the frontend so it can fall back to its
    // own simple keyword-based replies instead of erroring out.
    if (!process.env.GROQ_API_KEY) {
      return res.json({ reply: null, aiConfigured: false });
    }

    const context = await buildContext(req.userId);
    const systemPrompt = [
      'You are the study assistant built into EduFlow, a student campus dashboard app.',
      'Answer briefly and helpfully — 2 to 4 sentences unless the student explicitly asks for a list or more detail.',
      "You've been given the student's real, current data below. Use it to answer questions about their CGPA, deadlines, timetable, or study progress. Never invent data that isn't present here — if something isn't in the data, say you don't have that information.",
      'If the student asks something unrelated to their studies, you can still help, but keep the same brief, friendly tone.',
      '',
      "Student's current data:",
      JSON.stringify(context, null, 2),
    ].join('\n');

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: String(message).slice(0, 2000) },
        ],
        max_tokens: 300,
        temperature: 0.4,
      }),
    });

    if (!groqResponse.ok) {
      const body = await groqResponse.text().catch(() => '');
      console.error('Groq request failed', groqResponse.status, body);
      return res.json({ reply: null, aiConfigured: true, error: true });
    }

    const data = await groqResponse.json();
    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    res.json({ reply: reply || null, aiConfigured: true });
  } catch (e) {
    console.error('assistant chat error', e);
    res.status(500).json({ error: 'Could not reach the assistant.' });
  }
});

module.exports = router;
