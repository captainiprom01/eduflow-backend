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
const streakRoutes = require('./routes/streak');
const { generalLimiter } = require('./middleware/rateLimit');

const app = express();
const PORT = process.env.PORT || 4000;
const corsOrigin = process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*' ? process.env.CORS_ORIGIN.split(',') : '*';

app.use(cors({ origin: corsOrigin }));
app.use(express.json());
app.use(generalLimiter);

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
app.use('/api/streak', streakRoutes);

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`EduFlow API listening on port ${PORT}`));
  })
  .catch((e) => {
    console.error('Failed to initialize database', e);
    process.exit(1);
  });
