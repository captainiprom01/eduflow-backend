const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { assistantLimiter } = require('../middleware/rateLimit');

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

// Only these may ever be sent to Groq — never forward whatever string the
// client happens to send, since that field goes straight into an API call.
// Picked from Groq's "Allowed Models" default list so this works out of
// the box on a fresh Groq project without needing manual permission edits.
const ALLOWED_MODELS = {
  'openai/gpt-oss-120b': 'GPT-OSS 120B (most capable)',
  'openai/gpt-oss-20b': 'GPT-OSS 20B (fastest)',
  'qwen/qwen3.8-27b': 'Qwen3 27B',
};
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

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

router.get('/models', (req, res) => {
  const models = Object.entries(ALLOWED_MODELS).map(([id, label]) => ({ id, label }));
  res.json({ models, default: DEFAULT_MODEL, aiConfigured: !!process.env.GROQ_API_KEY });
});

router.post('/chat', assistantLimiter, async (req, res) => {
  try {
    const { message, model, history } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    // No key configured — tell the frontend so it can fall back to its
    // own simple keyword-based replies instead of erroring out.
    if (!process.env.GROQ_API_KEY) {
      return res.json({ reply: null, aiConfigured: false });
    }

    const selectedModel = Object.prototype.hasOwnProperty.call(ALLOWED_MODELS, model) ? model : DEFAULT_MODEL;
    const context = await buildContext(req.userId);
    const systemPrompt = [
      'You are the study assistant built into EduFlow, a student campus dashboard app.',
      'You are a genuinely capable academic assistant, similar to a general AI chat assistant — you can explain concepts, work through problems, help with essays or study material, discuss any academic subject, and hold a real back-and-forth conversation. You are not limited to only talking about the dashboard.',
      'Answer at whatever length actually suits the question — short and direct for quick facts, longer and structured (with steps or a list) when a real explanation is needed. Do not artificially shorten a good answer.',
      "You've also been given the student's real, current EduFlow data below (courses, CGPA, deadlines, timetable). Use it when it's relevant to what they're asking — for example if they ask about their workload, deadlines, or CGPA. Never invent data that isn't present here; if something isn't in the data, say you don't have that information rather than guessing.",
      '',
      "Student's current EduFlow data:",
      JSON.stringify(context, null, 2),
    ].join('\n');

    // Keep a little conversation memory so follow-up questions work
    // naturally, same as a normal chat assistant. Trust nothing about
    // shape/content from the client beyond role+text; cap how much we
    // forward so one request can't balloon token usage.
    const trimmedHistory = Array.isArray(history)
      ? history
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
          .slice(-10)
          .map((m) => ({ role: m.role, content: m.text.slice(0, 2000) }))
      : [];

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          ...trimmedHistory,
          { role: 'user', content: String(message).slice(0, 4000) },
        ],
        max_tokens: 1024,
        temperature: 0.5,
      }),
    });

    if (!groqResponse.ok) {
      const body = await groqResponse.text().catch(() => '');
      console.error('Groq request failed', groqResponse.status, body);
      return res.json({ reply: null, aiConfigured: true, error: true });
    }

    const data = await groqResponse.json();
    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    res.json({ reply: reply || null, aiConfigured: true, model: selectedModel });
  } catch (e) {
    console.error('assistant chat error', e);
    res.status(500).json({ error: 'Could not reach the assistant.' });
  }
});

module.exports = router;
