// e2e tests run against a dedicated database; never point this at development data.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'mysql://ce_app:ce_app_password@127.0.0.1:3306/creator_edu_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/1';
process.env.PLATFORM_ROOT_DOMAIN = 'lvh.me';
process.env.APP_HOST = 'app.lvh.me';
process.env.API_PUBLIC_URL ??= 'http://api.lvh.me:4000';
process.env.WEB_PUBLIC_URL = 'http://app.lvh.me:5173';
process.env.JWT_ACCESS_SECRET ??= 'test-secret-'.padEnd(48, 'x');
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.CSRF_SECRET ??= 'test-csrf-secret';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.AUTH_RATE_LIMIT_PER_MINUTE = '100000';
process.env.REFRESH_REUSE_GRACE_MS = '0';
process.env.SUPER_ADMIN_EMAIL = 'root@platform.test';
process.env.SUPER_ADMIN_INITIAL_PASSWORD = 'Sup3r-Admin-Passw0rd!';
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.SMS_PROVIDER;
