# Security

Status: **Phase 0 design**. Baseline: OWASP ASVS L2, OWASP Top 10.

## Authentication
- Passwords: argon2id (memory 19 MiB, t=2, p=1), min length 10, breached-password check optional (k-anonymity HIBP) .
- Access token: JWT (HS256 key ≥ 256-bit, or EdDSA), 15 min, held in memory by the SPA, never in localStorage.
- Refresh token: 256-bit random, stored **hashed** in `UserSession`, sent as `__Host-rt` cookie (httpOnly, Secure, SameSite=Lax, Path=/api/v1/auth). Rotated on every use; reuse of an old token revokes the whole session family and logs a security event.
- CSRF: refresh/logout endpoints require `X-CSRF-Token` matching a non-httpOnly double-submit cookie; all other APIs use bearer tokens (not cookie-authenticated).
- OTP: 6-digit, hashed, 10 min expiry, 5 attempts, resend throttled.
- Brute force: Redis rate limits per IP and per account (`@nestjs/throttler` with Redis storage); progressive lockout; all attempts in `LoginHistory`.
- 2FA (TOTP) **mandatory** for super/platform/finance/support admins; optional for creators.
- Sessions page: list devices, revoke one/all; password change revokes all other sessions.
- Google OAuth (PKCE, state + nonce) only when configured.

## Authorization
- RBAC: permission keys in `packages/shared/permissions.js`; roles map to permissions; `@RequirePermission()` on every mutating route. Default deny — a route without an auth decorator fails a CI check unless marked `@Public()`.
- Object-level checks in services (e.g., student can only read own submissions).
- Tenant isolation: see MULTI_TENANCY.md.

## Input / output
- Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`.
- Prisma parameterised queries only.
- Rich text stored as TipTap JSON, rendered via allow-listed node types; any HTML sanitised server-side (`sanitize-html`) and client-side (DOMPurify). Website builder blocks are schema-validated JSON — no raw HTML/JS blocks.
- Helmet with strict CSP (per-tenant allowed media/player origins), HSTS, frame-ancestors restricted (except embeddable player route).
- CORS: allow-list = platform hosts + verified tenant domains (resolved dynamically).

## Files
- MIME sniffing (magic bytes) + extension allow-list + size limit per purpose; images re-encoded; PDFs scanned (ClamAV optional adapter).
- Private buckets, presigned URLs ≤ 15 min, keys namespaced `tenants/{tenantId}/…`.

## Secrets
- Only in server env / AWS Secrets Manager. Frontend env (`VITE_*`) contains public values only (API URL, public keys like Razorpay key_id/Stripe publishable key).
- Tenant integration credentials encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY` / KMS data key), write-only via API (UI shows `••••last4`).
- Logs redact `authorization`, `cookie`, `password`, `token`, `secret`, card-like numbers.

## Webhooks
- Signature verification per provider (Razorpay HMAC-SHA256, Stripe `constructEvent`, Cashfree signature + timestamp, PayPal verify-webhook-signature API, Mux/VdoCipher signatures), raw body preserved, replay window enforced, idempotent via `WebhookEvent(provider,eventId)`.

## Payments
- No card data touches our servers (hosted checkout/SDK). Payment success is determined **only** from verified webhooks or server-side provider API fetch — never from the browser callback.

## Audit
`AuditLog` for: logins (admin), tenant create/suspend/delete, plan/subscription changes, payment config changes, refunds, role/permission changes, settings updates, data exports, impersonation (if ever added — requires reason + is logged).

## Privacy
- Data export & account deletion workflows (DPDP Act 2023 / GDPR ready), marketing consent per channel, unsubscribe links signed.
