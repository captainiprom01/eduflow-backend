require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDb } = require('./db');

const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');
const courseRoutes = require('./routes/courses');
const semesterRoutes = require('./routes/semesters');
const cgpaRoutes = require('./routes/cgpa');
const timetableRoutes = require('./routes/timetable');
const assignmentRoutes = require('./routes/assignments');
const taskRoutes = require('./routes/tasks');
const progressRoutes = require('./routes/progress');
const cronRoutes = require('./routes/cron');
const assistantRoutes = require('./routes/assistant');

if (!process.env.JWT_SECRET) {
  console.error('Missing JWT_SECRET environment variable. Set it in .env before starting the server.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable. Set it in .env before starting the server.');
  process.exit(1);
}

const app = express();

const corsOrigin = process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*'
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : true;
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.get('/', (req, res) => res.json({ ok: true, service: 'EduFlow API' }));

app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/semesters', semesterRoutes);
app.use('/api/cgpa', cgpaRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/assistant', assistantRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 4000;

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`EduFlow API listening on port ${PORT}`));
  })
  .catch((e) => {
    console.error('Failed to initialize the database', e);
    process.exit(1);
  });
