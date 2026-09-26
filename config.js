const { z } = require('zod');

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).startsWith('postgres', 'DATABASE_URL must be a PostgreSQL connection string'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must contain at least 32 characters'),
  CORS_ORIGIN: z.string().min(1),
  FRONTEND_URL: z.string().url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESET_EMAIL_FROM: z.string().optional(),
  CRON_SECRET: z.string().min(16).optional(),
  ANNOUNCEMENT_ADMIN_EMAILS: z.string().optional(),
  SESSION_COOKIE_NAME: z.string().min(1).default('eduflow_session'),
  SESSION_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Invalid environment configuration:\n- ${issues.join('\n- ')}`);
}

const env = parsed.data;
const config = {
  ...env,
  databaseUrl: env.DATABASE_URL,
  databasePoolMax: env.DATABASE_POOL_MAX,
  port: env.PORT,
  corsOrigins: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean),
};

module.exports = { config };
