const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function todayStrUtc() {
  return new Date().toISOString().slice(0, 10);
}

function isValidDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function daysBetween(dateStrA, dateStrB) {
  const a = new Date(dateStrA + 'T00:00:00Z');
  const b = new Date(dateStrB + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

// Called once per session boot. Updates the login streak using calendar
// days, not a rolling 24h window — so it doesn't matter what time of day
// someone logs in, only whether today is a new day since their last visit.
//
// "Today" is normally the server's UTC date, but the server and a
// person's own timezone can disagree about which calendar day it is —
// e.g. someone in Nigeria (UTC+1) checking in late evening might already
// be in a new local day while the server, still on UTC, considers it
// the previous one. When the frontend sends the device's own local date,
// prefer it — but only ever trust it within 1 day of the server's date,
// so a client can't manufacture a fake gap to jump the streak forward.
async function checkInStreak(userId, clientToday) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `
        SELECT
          COALESCE(current_streak, 0) AS current_streak,
          COALESCE(longest_streak, 0) AS longest_streak,
          last_active_date
        FROM users
        WHERE id = $1
        FOR UPDATE
      `,
      [userId]
    );

    if (!result.rows[0]) {
      throw new Error(`User ${userId} not found`);
    }

    const row = result.rows[0];
    const serverToday = todayStrUtc();

    const today =
      isValidDateStr(clientToday) &&
      Math.abs(daysBetween(serverToday, clientToday)) <= 1
        ? clientToday
        : serverToday;

    let currentStreak = Number(row.current_streak);

    if (!row.last_active_date) {
      currentStreak = 1;
    } else {
      const gap = daysBetween(row.last_active_date, today);

      if (gap === 0) {
        // Already checked in today — no change
      } else if (gap === 1) {
        currentStreak += 1;
      } else if (gap > 1) {
        currentStreak = 1; // Missed one or more days
      } else {
        // gap < 0 means future or same-day local-date quirk
        // do not move the streak backward
      }
    }

    const longestStreak = Math.max(Number(row.longest_streak), currentStreak);

    await client.query(
      'UPDATE users SET current_streak = $1, longest_streak = $2, last_active_date = $3 WHERE id = $4',
      [currentStreak, longestStreak, today, userId]
    );

    await client.query('COMMIT');

    return { currentStreak, longestStreak };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

router.get('/', async (req, res) => {
  try {
    const { currentStreak, longestStreak } = await checkInStreak(
      req.userId,
      req.query.localDate
    );

    const [coursesR, semestersR, assignmentsR, tasksR, cgpaR] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM courses WHERE user_id = $1', [req.userId]),
      pool.query('SELECT COUNT(*)::int AS n FROM semesters WHERE user_id = $1', [req.userId]),
      pool.query(
        'SELECT COUNT(*)::int AS n FROM assignments WHERE user_id = $1 AND done = true',
        [req.userId]
      ),
      pool.query(
        'SELECT COUNT(*)::int AS n FROM study_tasks WHERE user_id = $1 AND done = true',
        [req.userId]
      ),
      pool.query(
        `SELECT ce.grade, c.units
         FROM cgpa_entries ce
         JOIN courses c ON c.id = ce.course_id
         WHERE ce.user_id = $1`,
        [req.userId]
      ),
    ]);

    const GRADE_POINTS = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };
    let points = 0;
    let units = 0;

    cgpaR.rows.forEach((r) => {
      points += (GRADE_POINTS[r.grade] || 0) * r.units;
      units += Number(r.units);
    });

    const cgpa = units ? points / units : 0;

    const courseCount = coursesR.rows[0].n;
    const semesterCount = semestersR.rows[0].n;
    const completedAssignments = assignmentsR.rows[0].n;
    const completedTasks = tasksR.rows[0].n;

    const achievements = [
      {
        id: 'first_course',
        title: 'Getting Started',
        description: 'Add your first course',
        icon: 'fa-book-open',
        unlocked: courseCount >= 1,
      },
      {
        id: 'organizer',
        title: 'Organizer',
        description: 'Add 5 or more courses',
        icon: 'fa-folder-open',
        unlocked: courseCount >= 5,
      },
      {
        id: 'first_grade',
        title: 'On the Board',
        description: 'Log your first grade',
        icon: 'fa-calculator',
        unlocked: units > 0,
      },
      {
        id: 'first_class',
        title: 'First Class Material',
        description: 'Reach a First Class cumulative CGPA',
        icon: 'fa-trophy',
        unlocked: cgpa >= 4.5,
      },
      {
        id: 'two_semesters',
        title: 'Semester Streak',
        description: 'Log grades across 2 or more semesters',
        icon: 'fa-layer-group',
        unlocked: semesterCount >= 2,
      },
      {
        id: 'task_crusher',
        title: 'Task Crusher',
        description: 'Complete 10 assignments or study tasks',
        icon: 'fa-list-check',
        unlocked: completedAssignments + completedTasks >= 10,
      },
      {
        id: 'streak_7',
        title: 'Week Warrior',
        description: 'Reach a 7-day streak',
        icon: 'fa-fire',
        unlocked: longestStreak >= 7,
      },
      {
        id: 'streak_30',
        title: 'Unstoppable',
        description: 'Reach a 30-day streak',
        icon: 'fa-fire',
        unlocked: longestStreak >= 30,
      },
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
