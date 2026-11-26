# TechX LMS on the VPS

Live at **https://lmsadmin.techxsolutions.io** (Super Admin — opens login directly, no forgot-password)
and **https://lms.techxsolutions.io** (agency / client panel). Academies get
`https://<slug>.lms.techxsolutions.io` (wildcard DNS `*.lms` → server); `lms-auto-certs` issues each
academy address its own Let's Encrypt certificate within a minute.

Set in `/opt/lms/shared/.env` (and rebuild the web app after changing `VITE_*`):
`PLATFORM_ROOT_DOMAIN=lms.techxsolutions.io`, `APP_HOST=lms.techxsolutions.io`,
`ADMIN_HOST=lmsadmin.techxsolutions.io`, matching `VITE_PLATFORM_ROOT_DOMAIN` / `VITE_APP_HOST` /
`VITE_ADMIN_HOST`.

**Transactional email (Resend SMTP):** point the worker at Resend so student invites and other
mail leave via `smtp.resend.com`. Set (or update) these keys in `/opt/lms/shared/.env`, then
`pm2 restart lms-api lms-worker`:

```
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASS=<resend_api_key>
MAIL_FROM="LMS Notifications <lmsnotifications@techxsolutions.io>"
```

The From domain (`techxsolutions.io`) must be verified in the Resend dashboard. Do not commit
the API key; keep it only in the shared env file on the server.

| Piece | Where |
|---|---|
| Code (one folder per release) | `/opt/lms/releases/<commit>`, current → `/opt/lms/current` |
| Environment (secrets, root-only) | `/opt/lms/shared/.env` — edit, then `pm2 restart lms-api lms-worker` |
| Processes | pm2 `lms-api` (127.0.0.1:4100) and `lms-worker`, from `ecosystem.config.cjs` (Node 24 in `/opt/node24`) |
| Database / cache | MySQL database `lms` (user `lms`), Redis on 127.0.0.1:6379 db 0 |
| Files | S3 bucket from `.env` (CORS rule `techx-lms`, see `s3-cors.mjs`) |
| nginx | `sites-enabled/lms.conf`, `snippets/lms-app.conf`, `snippets/lms-security-headers.conf`, `lms-portals/*.conf` |
| Academy HTTPS | `/usr/local/bin/lms-auto-certs`, systemd `lms-certs.timer` (every minute) |

The server also runs other sites (TechX CRM, clientinvoice, spacetoroof); the LMS only adds the files
above and reuses the existing port-80 site (Let's Encrypt webroot `/var/www/letsencrypt`) and TLS snippet.

**Deploy an update:** commit, then run `infra/vps/deploy.sh` from the repo root.
