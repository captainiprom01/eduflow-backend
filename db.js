const { Pool, types } = require('pg');

// By default node-postgres parses SQL DATE columns into JS Date objects at
// UTC midnight, which can silently shift a day backwards once converted to
// a local timezone. EduFlow only ever needs plain 'YYYY-MM-DD' strings for
// due dates, so we tell the driver to hand dates back as-is.
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: true }
    : false,
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
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    last_active_date DATE,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

  CREATE TABLE IF NOT EXISTS achievements_earned (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_key TEXT NOT NULL,
    earned_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, achievement_key)
  );

  CREATE INDEX IF NOT EXISTS idx_achievements_user_id ON achievements_earned(user_id);

  CREATE TABLE IF NOT EXISTS courses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT,
    units INTEGER NOT NULL,
    instructor TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_courses_user_id ON courses(user_id);

  CREATE TABLE IF NOT EXISTS semesters (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_semesters_user_id ON semesters(user_id);

  CREATE TABLE IF NOT EXISTS cgpa_entries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    grade TEXT NOT NULL CHECK (grade IN ('A','B','C','D','E','F')),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (semester_id, course_id)
  );

  CREATE INDEX IF NOT EXISTS idx_cgpa_entries_user_id ON cgpa_entries(user_id);
  CREATE INDEX IF NOT EXISTS idx_cgpa_entries_semester_id ON cgpa_entries(semester_id);

  CREATE TABLE IF NOT EXISTS timetable (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    day TEXT NOT NULL CHECK (day IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    location TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_timetable_user_id ON timetable(user_id);
  CREATE INDEX IF NOT EXISTS idx_timetable_course_id ON timetable(course_id);

  CREATE TABLE IF NOT EXISTS assignments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    due_date DATE NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
    done BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_assignments_user_id ON assignments(user_id);
  CREATE INDEX IF NOT EXISTS idx_assignments_due_date ON assignments(due_date);
  CREATE INDEX IF NOT EXISTS idx_assignments_done ON assignments(done);

  CREATE TABLE IF NOT EXISTS study_tasks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_study_tasks_user_id ON study_tasks(user_id);
  CREATE INDEX IF NOT EXISTS idx_study_tasks_done ON study_tasks(done);
`;

// Track migrations to avoid data inconsistencies
const MIGRATION_FLAGS = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id SERIAL PRIMARY KEY,
    migration_name TEXT UNIQUE NOT NULL,
    executed_at TIMESTAMPTZ DEFAULT now()
  );
`;

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Initialize migrations table
    await client.query(MIGRATION_FLAGS);

    // Check if email verification migration has run
    const migrationResult = await client.query(
      'SELECT 1 FROM _migrations WHERE migration_name = $1',
      ['email_verification_migration']
    );

    // Run the main schema
    await client.query(SCHEMA);

    // Email verification migration: only run once
    if (migrationResult.rows.length === 0) {
      await client.query(
        'UPDATE users SET email_verified = true WHERE created_at < now() - interval \'1 minute\''
      );
      await client.query(
        'INSERT INTO _migrations (migration_name) VALUES ($1)',
        ['email_verification_migration']
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Database initialization failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function closeDb() {
  await pool.end();
}

module.exports = { pool, initDb, closeDb };
