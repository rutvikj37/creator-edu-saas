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
  // WhatsApp Cloud API (optional; business-initiated messages need an approved template)
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_TEMPLATE_NAME: z.string().optional(),
  WHATSAPP_TEMPLATE_LANG: z.string().default('en'),
  // Web push (optional; generate with `npx web-push generate-vapid-keys`)
  WEB_PUSH_VAPID_PUBLIC_KEY: z.string().optional(),
  WEB_PUSH_VAPID_PRIVATE_KEY: z.string().optional(),
  WEB_PUSH_SUBJECT: z.string().optional(),
  // LiveKit (optional; live classes report "not configured" without these)
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  // plugNmeet (optional; self-hosted plugNmeet server for live classes and webinars)
  /** Server base URL, e.g. https://meet.example.com (the plugNmeet client is served from it). */
  PLUGNMEET_URL: z.url().optional().or(z.literal('')),
  PLUGNMEET_API_KEY: z.string().optional(),
  PLUGNMEET_API_SECRET: z.string().optional(),
  // Bunny Stream (primary video provider). Without these, uploads use private storage (Phase 6).
  BUNNY_STREAM_API_KEY: z.string().optional(),
  BUNNY_STREAM_LIBRARY_ID: z.string().regex(/^\d+$/).optional().or(z.literal('')),
  BUNNY_STREAM_CDN_HOSTNAME: z.string().optional(),
  /** Shared secret embedded in the webhook URL configured in Bunny (≥ 24 chars). */
  BUNNY_STREAM_WEBHOOK_SECRET: z.string().optional(),
  /** Library "Token authentication key" — signs player embed tokens. */
  BUNNY_STREAM_TOKEN_AUTH_KEY: z.string().optional(),
  /** Optional account API key: reads library storage/traffic usage from the core API. */
  BUNNY_ACCOUNT_API_KEY: z.string().optional(),
  BUNNY_STREAM_API_BASE_URL: z.string().url().default('https://video.bunnycdn.com'),
  BUNNY_CORE_API_BASE_URL: z.string().url().default('https://api.bunny.net'),
  BUNNY_STREAM_TUS_ENDPOINT: z.string().url().default('https://video.bunnycdn.com/tusupload'),
  BUNNY_STREAM_EMBED_BASE_URL: z.string().url().default('https://iframe.mediadelivery.net'),
  /** Upload limits for video files. */
  VIDEO_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(20 * 1024 ** 3),
  VIDEO_PROCESSING_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(180),
  // Google Drive backups (optional; backups report "not connected" without these)
  GOOGLE_DRIVE_CLIENT_ID: z.string().optional(),
  GOOGLE_DRIVE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_DRIVE_REDIRECT_URI: z.string().url().optional().or(z.literal('')),
  GOOGLE_DRIVE_ROOT_FOLDER: z.string().default('TechX-LMS-Backups'),
  /** Test-only override of https://www.googleapis.com/ */
  GOOGLE_API_ROOT_URL: z.string().url().optional().or(z.literal('')),
  /** 32-byte key (base64) that encrypts backup files. Keep a copy offline: without it backups cannot be restored. */
  BACKUP_ENCRYPTION_KEY: z.string().optional().refine((v) => !v || Buffer.from(v, 'base64').length === 32, 'BACKUP_ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Claude model for AI features. */
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
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
  // Object storage. 'local' stores files on disk (development/tests only); production uses 's3'.
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage'),
  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional().or(z.literal('')),
  S3_PRIVATE_BUCKET: z.string().default('ce-private-dev'),
  S3_PUBLIC_BUCKET: z.string().default('ce-public-dev'),
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
  if (parsed.data.NODE_ENV === 'production' && parsed.data.STORAGE_DRIVER === 'local') {
    throw new Error('STORAGE_DRIVER=local is for development only; configure S3 in production');
  }
  return parsed.data;
}
