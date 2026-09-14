const rateLimit = require('express-rate-limit');

// Applied to every request. Generous — this is just a backstop against
// something going badly wrong (a bug causing a request loop, a bot
// hammering the API), not meant to bother real usage.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this device. Please slow down and try again shortly.' },
});

// Tighter limit on signup/login/forgot-password/Google sign-in — the
// endpoints someone could otherwise hammer to brute-force a password or
// spam accounts/emails.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
});

// Per logged-in user (not per IP) — protects your Groq usage from one
// account spamming the assistant. Falls back to IP if userId isn't set
// yet for some reason, so it never accidentally allows unlimited use.
const assistantLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.userId ? `user:${req.userId}` : req.ip),
  message: { error: "You've reached the hourly limit for assistant messages. Try again in a bit." },
});

module.exports = { generalLimiter, authLimiter, assistantLimiter };
