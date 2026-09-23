const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined');
}

const isLocalDatabase =
  process.env.DATABASE_URL.includes('localhost') ||
  process.env.DATABASE_URL.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error', err);
});

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    google_id TEXT UNIQUE,
    reset_token_hash TEXT,
    reset_token_expires TIMESTAMPTZ,
    email_verified BOOLEAN NOT NULL DEFAULT false,
    verify_token_hash TEXT,
    verify_token_expires TIMESTAMPTZ,
    current_streak INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
    longest_streak INTEGER NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
    last_active_date DATE,
    school TEXT,
    department TEXT,
    programme TEXT,
    level TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS reset_token_hash TEXT,
    ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS verify_token_hash TEXT,
    ADD COLUMN IF NOT EXISTS verify_token_expires TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS current_streak INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS longest_streak INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_active_date DATE,
    ADD COLUMN IF NOT EXISTS school TEXT,
    ADD COLUMN IF NOT EXISTS department TEXT,
    ADD COLUMN IF NOT EXISTS programme TEXT,
    ADD COLUMN IF NOT EXISTS level TEXT;

  CREATE TABLE IF NOT EXISTS courses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT,
    units INTEGER NOT NULL CHECK (units >= 0),
    instructor TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS semesters (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS cgpa_entries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    grade TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, semester_id, course_id)
  );

  CREATE TABLE IF NOT EXISTS timetable (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    location TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS assignments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    due_date DATE NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    done BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS study_tasks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS achievements_earned (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_key TEXT NOT NULL,
    earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, achievement_key)
  );

  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    assignment_notifications BOOLEAN NOT NULL DEFAULT true,
    announcement_notifications BOOLEAN NOT NULL DEFAULT true,
    grade_notifications BOOLEAN NOT NULL DEFAULT true,
    message_notifications BOOLEAN NOT NULL DEFAULT true,
    ai_suggestions BOOLEAN NOT NULL DEFAULT true,
    ai_reminders BOOLEAN NOT NULL DEFAULT true,
    ai_model TEXT NOT NULL DEFAULT '',
    analytics_sharing BOOLEAN NOT NULL DEFAULT true,
    profile_visibility BOOLEAN NOT NULL DEFAULT true,
    theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct', 'group')),
    title TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_read_at TIMESTAMPTZ,
    PRIMARY KEY (conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL DEFAULT 'Campus',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT 'EduFlow',
    icon TEXT NOT NULL DEFAULT 'fa-bullhorn',
    color TEXT NOT NULL DEFAULT '#2563eb',
    bg TEXT NOT NULL DEFAULT '#eff6ff',
    published BOOLEAN NOT NULL DEFAULT true,
    published_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS announcement_reads (
    announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (announcement_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS study_activity (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_date DATE NOT NULL,
    source TEXT NOT NULL DEFAULT 'study',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, activity_date)
  );

  CREATE INDEX IF NOT EXISTS idx_courses_user_id ON courses(user_id);
  CREATE INDEX IF NOT EXISTS idx_semesters_user_id ON semesters(user_id);
  CREATE INDEX IF NOT EXISTS idx_assignments_user_id ON assignments(user_id);
  CREATE INDEX IF NOT EXISTS idx_study_tasks_user_id ON study_tasks(user_id);
  CREATE INDEX IF NOT EXISTS idx_conversation_members_user_id ON conversation_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements(published, published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_study_activity_user_date ON study_activity(user_id, activity_date DESC);
`;

async function initDb() {
  try {
    await pool.query('SELECT 1');
    await pool.query(SCHEMA);
    await pool.query("ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS ai_model TEXT NOT NULL DEFAULT ''");
    await pool.query("ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS analytics_sharing BOOLEAN NOT NULL DEFAULT true");
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM announcements');
    if (count.rows[0].n === 0) {
      await pool.query(`INSERT INTO announcements (category, title, body, author, icon, color, bg) VALUES
        ('Academic','Examination timetable updates','Check the latest examination schedule and confirm your courses before the registration deadline.','Examinations Office','fa-calendar-days','#2563eb','#eff6ff'),
        ('Campus','Extended library opening hours','The main library will remain open later during the revision period to support students preparing for assessments.','University Library','fa-building-columns','#059669','#ecfdf5'),
        ('Events','EduFlow study skills workshop','Join this week’s practical session on planning a study week, managing deadlines, and using EduAI effectively.','Student Success Team','fa-lightbulb','#7c3aed','#f5f3ff'),
        ('Campus','Student support services available','Academic advising, counselling, and accessibility support remain available through the student services centre.','Student Affairs','fa-heart','#db2777','#fdf2f8')`);
    }
    console.log('Database ready');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

module.exports = { pool, initDb };
