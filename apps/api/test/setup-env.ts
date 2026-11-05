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
process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_STORAGE_DIR = '/tmp/ce-e2e-storage';
// Bunny Stream: the e2e suite routes provider HTTP through test/bunny-sim.ts (no network).
process.env.BUNNY_STREAM_API_KEY = 'test-bunny-library-key';
process.env.BUNNY_STREAM_LIBRARY_ID = '424242';
process.env.BUNNY_STREAM_CDN_HOSTNAME = 'vz-test.b-cdn.net';
process.env.BUNNY_STREAM_WEBHOOK_SECRET = 'test-webhook-secret-0123456789abcdef';
process.env.BUNNY_STREAM_TOKEN_AUTH_KEY = 'test-token-auth-key';
process.env.BUNNY_ACCOUNT_API_KEY = 'test-bunny-account-key';
// Google Drive backups: test/drive-sim.ts serves the Drive API on a local port.
process.env.GOOGLE_DRIVE_CLIENT_ID = 'test-drive-client.apps.googleusercontent.com';
process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'test-drive-client-secret';
process.env.GOOGLE_DRIVE_REDIRECT_URI = 'http://api.lvh.me:4000/api/v1/backups/drive/oauth/callback';
process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

// Zoom: base URLs have defaults in the env schema, so they are fixed here (before the app's config
// snapshot); test/meeting-sims.ts ZoomSim listens on this port.
process.env.ZOOM_OAUTH_BASE_URL = 'http://127.0.0.1:47811';
process.env.ZOOM_API_BASE_URL = 'http://127.0.0.1:47811/v2';
