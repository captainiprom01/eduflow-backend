const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const router = express.Router();
router.use(requireAuth);

const streakLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each authenticated client/IP to 100 requests per window
});

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysBetween(dateStrA, dateStrB) {
  const a = new Date(dateStrA + 'T00:00:00Z');
  const b = new Date(dateStrB + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

// Called once per session boot. Updates the login streak using calendar
// days, not a rolling 24h window — so it doesn't matter what time of day
// someone logs in, only whether today is a new day since their last visit.
async function checkInStreak(userId) {
  const result = await pool.query(
    'SELECT current_streak, longest_streak, last_active_date FROM users WHERE id = $1',
    [userId]
  );
  const row = result.rows[0];
  const today = todayStr();
  let currentStreak = row.current_streak;

  if (!row.last_active_date) {
    currentStreak = 1;
  } else {
    const gap = daysBetween(row.last_active_date, today);
    if (gap === 0) {
      // Already checked in today — no change.
    } else if (gap === 1) {
      currentStreak = row.current_streak + 1;
    } else {
      currentStreak = 1; // missed a day or more — streak resets
    }
  }

  const longestStreak = Math.max(row.longest_streak, currentStreak);
  await pool.query(
    'UPDATE users SET current_streak = $1, longest_streak = $2, last_active_date = $3 WHERE id = $4',
    [currentStreak, longestStreak, today, userId]
  );
  return { currentStreak, longestStreak };
}

router.get('/', streakLimiter, async (req, res) => {
  try {
    const { currentStreak, longestStreak } = await checkInStreak(req.userId);

    const [coursesR, semestersR, assignmentsR, tasksR, cgpaR] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM courses WHERE user_id = $1', [req.userId]),
      pool.query('SELECT COUNT(*)::int AS n FROM semesters WHERE user_id = $1', [req.userId]),
      pool.query('SELECT COUNT(*)::int AS n FROM assignments WHERE user_id = $1 AND done = true', [req.userId]),
      pool.query('SELECT COUNT(*)::int AS n FROM study_tasks WHERE user_id = $1 AND done = true', [req.userId]),
      pool.query(
        `SELECT ce.grade, c.units FROM cgpa_entries ce JOIN courses c ON c.id = ce.course_id WHERE ce.user_id = $1`,
        [req.userId]
      ),
    ]);

    const GRADE_POINTS = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };
    let points = 0;
    let units = 0;
    cgpaR.rows.forEach((r) => {
      points += GRADE_POINTS[r.grade] * r.units;
      units += r.units;
    });
    const cgpa = units ? points / units : 0;

    const courseCount = coursesR.rows[0].n;
    const semesterCount = semestersR.rows[0].n;
    const completedAssignments = assignmentsR.rows[0].n;
    const completedTasks = tasksR.rows[0].n;

    const achievements = [
      { id: 'first_course', title: 'Getting Started', description: 'Add your first course', icon: 'fa-book-open', unlocked: courseCount >= 1 },
      { id: 'organizer', title: 'Organizer', description: 'Add 5 or more courses', icon: 'fa-folder-open', unlocked: courseCount >= 5 },
      { id: 'first_grade', title: 'On the Board', description: 'Log your first grade', icon: 'fa-calculator', unlocked: units > 0 },
      { id: 'first_class', title: 'First Class Material', description: 'Reach a First Class cumulative CGPA', icon: 'fa-trophy', unlocked: cgpa >= 4.5 },
      { id: 'two_semesters', title: 'Semester Streak', description: 'Log grades across 2 or more semesters', icon: 'fa-layer-group', unlocked: semesterCount >= 2 },
      { id: 'task_crusher', title: 'Task Crusher', description: 'Complete 10 assignments or study tasks', icon: 'fa-list-check', unlocked: completedAssignments + completedTasks >= 10 },
      { id: 'streak_7', title: 'Week Warrior', description: 'Reach a 7-day streak', icon: 'fa-fire', unlocked: longestStreak >= 7 },
      { id: 'streak_30', title: 'Unstoppable', description: 'Reach a 30-day streak', icon: 'fa-fire', unlocked: longestStreak >= 30 },
    ];

    res.json({
      currentStreak,
      longestStreak,
      unlockedCount: achievements.filter((a) => a.unlocked).length,
      totalCount: achievements.length,
      achievements,
    });
  } catch (e) {
    console.error('streak/achievements error', e);
    res.status(500).json({ error: 'Could not load your streak.' });
  }
});

module.exports = router;
