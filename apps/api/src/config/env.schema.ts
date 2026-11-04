import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/**
 * Server environment contract. The process refuses to start when a required value is
 * missing or malformed, so misconfiguration fails fast instead of at first use.
 * Optional integration credentials are validated by each integration adapter, which
 * reports `not_configured` when they are absent.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().min(1).default('Creator Education'),
  PLATFORM_ROOT_DOMAIN: z.string().min(1),
  APP_HOST: z.string().min(1),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_PUBLIC_URL: z.url(),
  WEB_PUBLIC_URL: z.url(),
  TRUSTED_PROXIES: z.string().default('loopback'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().startsWith('mysql://'),
  REDIS_URL: z.string().startsWith('redis'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
  CSRF_SECRET: z.string().min(8),
  SWAGGER_ENABLED: bool.optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  JWT_ACCESS_TTL: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  // Email (SMTP). Development default points at Mailpit.
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: bool.optional(),
  MAIL_FROM: z.string().default('Creator Education <no-reply@localhost>'),
  // SMS (optional; OTP over SMS reports "not configured" without these)
  SMS_PROVIDER: z.enum(['twilio', 'msg91']).optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),
  // Google sign-in (optional)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Initial super admin (used once by the seed)
  SUPER_ADMIN_EMAIL: z.email().optional().or(z.literal('')),
  SUPER_ADMIN_INITIAL_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_ACCESS_SECRET.startsWith('dev-only')) {
    throw new Error('Refusing to start in production with a development JWT secret');
  }
  return parsed.data;
}
