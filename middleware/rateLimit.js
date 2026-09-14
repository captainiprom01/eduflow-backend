const rateLimit = require('express-rate-limit');
const redis = require('redis');
const RedisStore = require('rate-limit-redis');

// Initialize Redis client for distributed rate limiting
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
});

// Helper function to get client IP from request (handles proxies)
const getClientIp = (req) => {
  return (
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket.remoteAddress
  );
};

// Applied to every request. Generous — this is just a backstop against
// something going badly wrong (a bug causing a request loop, a bot
// hammering the API), not meant to bother real usage.
const generalLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:general:',
  }),
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.GENERAL_RATE_LIMIT || 300),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path === '/status',
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests from this device. Please slow down and try again shortly.' });
  },
  onLimitReached: (req, res, options) => {
    console.warn(`General rate limit exceeded from IP: ${getClientIp(req)}, Path: ${req.path}`);
  },
});

// Tighter limit on signup/login/forgot-password/Google sign-in — the
// endpoints someone could otherwise hammer to brute-force a password or
// spam accounts/emails.
const authLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:auth:',
  }),
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT || 20),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIp(req),
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
  },
  onLimitReached: (req, res, options) => {
    console.warn(`Auth rate limit exceeded from IP: ${getClientIp(req)}, Path: ${req.path}`);
  },
});

// Per logged-in user (not per IP) — protects your Groq usage from one
// account spamming the assistant. Falls back to IP if userId isn't set
// yet for some reason, so it never accidentally allows unlimited use.
const assistantLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:assistant:',
  }),
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.ASSISTANT_RATE_LIMIT || 40),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.userId ? `user:${req.userId}` : getClientIp(req)),
  handler: (req, res) => {
    res.status(429).json({ error: "You've reached the hourly limit for assistant messages. Try again in a bit." });
  },
  onLimitReached: (req, res, options) => {
    console.warn(`Assistant rate limit exceeded for: ${req.userId ? `user ${req.userId}` : `IP ${getClientIp(req)}`}`);
  },
});

module.exports = { generalLimiter, authLimiter, assistantLimiter };
