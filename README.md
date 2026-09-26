# EduFlow API

Express + PostgreSQL backend for EduFlow. Handles accounts, courses,
timetable, assignments, study tasks, and semester-by-semester CGPA. The
grade-point math and classification logic live only here — the frontend
never receives the formula, only the finished numbers.

## What's in here

```
backend/
  server.js            entry point, wires up routes
  config.js            validated environment configuration
  db.js                Postgres pool + connectivity check
  migrations/          versioned database schema changes
  tools/migrate.js     migration runner
  middleware/auth.js   JWT verification
  middleware/errors.js centralized error responses
  routes/
    auth.js            signup, login, /me
    courses.js
    semesters.js
    cgpa.js             <- grade points + classification logic lives here
    timetable.js
    assignments.js
    tasks.js
    progress.js         <- completion % logic lives here
```

Database schema changes are versioned in `migrations/` and must be applied
before starting the API with `npm run migrate`. Normal server startup only
checks database connectivity.

## 1. Local setup

Requirements: Node 18+, a Postgres database (see step 2 for a free one).

```bash
cd backend
npm install
cp .env.example .env
npm run migrate
npm run dev
```

The API starts on `http://localhost:4000` (or whatever `PORT` you set).
Visit `http://localhost:4000/` — you should see `{"ok":true,...}`.

The health endpoints are `/health/live` for process liveness and
`/health/ready` for database readiness. Run the complete local checks with:

```bash
npm test
```

See [`docs/operations.md`](docs/operations.md) for backup, restore, monitoring,
scheduled-job, and incident-response procedures.

Generate a JWT secret quickly with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 2. Free database: Neon

Render's own free Postgres deletes itself after 30 days, so this project
pairs Render (for the server) with **Neon**, which has a permanent free
Postgres tier (no card, no expiry, ~0.5GB storage — plenty for this app).

1. Go to https://neon.tech and sign up.
2. Create a project (any region close to you).
3. Copy the connection string it gives you (it already includes
   `?sslmode=require`) into `DATABASE_URL`.

## 3. Free hosting: Render

1. Push this `backend/` folder to its own GitHub repo (or a subfolder of
   a repo — Render lets you set a root directory).
2. In Render: **New > Web Service**, connect the repo.
3. Settings:
   - Root directory: `backend` (if part of a bigger repo)
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
4. Add environment variables in the Render dashboard (not in a committed
   file): `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN` (set this to your
   deployed frontend's URL once you have one, e.g.
   `https://yourname.github.io`).
5. Deploy. Render gives you a URL like
   `https://eduflow-api.onrender.com`.

Note: on Render's free tier the service spins down after 15 minutes of
no traffic and takes a few seconds to wake back up on the next request —
normal for a free hobby project, just expect the first request after a
quiet spell to be slow.

## 4. Point the frontend at it

Open the frontend, log in, and in the "Server URL" field on the login
screen enter your Render URL (e.g. `https://eduflow-api.onrender.com`).
It's saved in the browser so you only need to do this once per device.

## Security notes (honest ones)

- Passwords are hashed with bcrypt — never stored in plain text.
- Sessions are JWTs valid for 30 days, sent as `Authorization: Bearer <token>`.
- All data routes are scoped to `req.userId`, so one account can never
  read or modify another account's rows.
- This is a solid setup for a personal/student project. It has not been
  audited for production use with real payment data or at scale — for
  that you'd want things like rate limiting, refresh tokens, email
  verification, and a proper secrets manager.
