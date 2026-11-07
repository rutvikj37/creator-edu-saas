import { validateEnv } from './env.schema.js';

const base = {
  PLATFORM_ROOT_DOMAIN: 'lvh.me',
  APP_HOST: 'app.lvh.me',
  API_PUBLIC_URL: 'http://api.lvh.me:4000',
  WEB_PUBLIC_URL: 'http://app.lvh.me:5173',
  DATABASE_URL: 'mysql://u:p@localhost:3306/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  CSRF_SECRET: 'csrf-secret',
};

describe('validateEnv', () => {
  it('accepts a complete configuration and applies defaults', () => {
    const env = validateEnv(base);
    expect(env.API_PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('treats a blank SMS_PROVIDER as not configured', () => {
    expect(validateEnv({ ...base, SMS_PROVIDER: '' }).SMS_PROVIDER).toBeUndefined();
    expect(validateEnv({ ...base, SMS_PROVIDER: 'msg91' }).SMS_PROVIDER).toBe('msg91');
    expect(() => validateEnv({ ...base, SMS_PROVIDER: 'nope' })).toThrow(/SMS_PROVIDER/);
  });

  it('rejects a short JWT secret', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects a non-MySQL database URL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: 'postgres://x' })).toThrow(/DATABASE_URL/);
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    expect(() => validateEnv({ ...base, ENCRYPTION_KEY: 'abc' })).toThrow(/ENCRYPTION_KEY/);
  });

  it('refuses development secrets in production', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: 'dev-only-' + 'x'.repeat(40) }),
    ).toThrow(/production/);
  });
});
