const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const DAILY_QUOTES = [
  'Small steps every day beat big pushes once in a while.',
  'Progress, not perfection. Focus on the next useful step.',
  'Consistency beats intensity. Give yourself a focused session today.',
  'Every assignment you finish is one less thing carrying weight in your head.',
  'Study smart, not just hard. Protect your focus and your rest.',
  'A focused twenty minutes can change the direction of your whole day.',
  'You do not need to finish everything today; start with the next useful thing.',
  'Your future self benefits from the effort you make in this moment.',
  'Learning compounds quietly. Keep adding one clear step at a time.',
  'Make progress visible: choose one task, begin it, and stay with it.',
];

function isValidDateStr(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dayNumber(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

router.get('/daily', (req, res) => {
  const date = isValidDateStr(req.query.date)
    ? req.query.date
    : new Date().toISOString().slice(0, 10);
  const index = ((dayNumber(date) % DAILY_QUOTES.length) + DAILY_QUOTES.length) % DAILY_QUOTES.length;
  res.json({ quote: DAILY_QUOTES[index], quoteId: index, date });
});

module.exports = router;
