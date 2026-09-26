require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { config } = require('./config');
const { initDb, pool } = require('./db');
const logger = require('./lib/logger');
const { requestContext } = require('./middleware/requestContext');
const { notFound, errorHandler } = require('./middleware/errors');

const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');
const courseRoutes = require('./routes/courses');
const semesterRoutes = require('./routes/semesters');
const messageRoutes = require('./routes/messages');
const cgpaRoutes = require('./routes/cgpa');
const timetableRoutes = require('./routes/timetable');
const assignmentRoutes = require('./routes/assignments');
const taskRoutes = require('./routes/tasks');
const progressRoutes = require('./routes/progress');
const cronRoutes = require('./routes/cron');
const assistantRoutes = require('./routes/assistant');
const streakRoutes = require('./routes/streak');
const quoteRoutes = require('./routes/quotes');
const { router: announcementRoutes } = require('./routes/announcements');
const { generalLimiter } = require('./middleware/rateLimit');
const { attachRealtime } = require('./realtime');

const app = express();
const server = http.createServer(app);
const realtime = attachRealtime(server);

app.use(requestContext);
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'EduFlow API' });
});

async function readinessHandler(req, res) {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (error) {
    logger.error('health.database_check_failed', { requestId: req.requestId, error: error.message });
    res.status(503).json({ status: 'degraded', requestId: req.requestId });
  }
}

app.get('/health/live', (req, res) => res.json({ status: 'ok' }));
app.get('/health/ready', readinessHandler);
app.get('/health', readinessHandler);

app.use(generalLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/semesters', semesterRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/cgpa', cgpaRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/streak', streakRoutes);
app.use('/api/quotes', quoteRoutes);
app.use('/api/announcements', announcementRoutes);

app.use(notFound);
app.use(errorHandler);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('process.shutdown_started', { signal });
  realtime.close();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
  logger.info('process.shutdown_complete');
}

async function start() {
  await initDb();
  await new Promise((resolve) => server.listen(config.port, resolve));
  logger.info('server.started', { port: config.port, environment: config.NODE_ENV });
  return server;
}

if (require.main === module) {
  process.once('SIGTERM', () => shutdown('SIGTERM').then(() => process.exit(0)));
  process.once('SIGINT', () => shutdown('SIGINT').then(() => process.exit(0)));
  start().catch((error) => {
    logger.error('server.start_failed', { error: error.message, stack: error.stack });
    process.exit(1);
  });
}

module.exports = { app, server, start, shutdown };
