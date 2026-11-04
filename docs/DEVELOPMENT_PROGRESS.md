# Development Progress & Roadmap

Legend: ⬜ not started · 🟨 in progress · ✅ done (meets Definition of Done) · ⏸ blocked

| Phase | Scope | Exit criteria | Status |
|---|---|---|---|
| 0 Discovery & planning | env inspection, architecture, ERD, module map, navigation, roadmap, docs | Docs approved by owner | ✅ approved 2026-11-04 |
| 1 Foundation | pnpm monorepo, NestJS api+worker, React/Vite/Tailwind web, Prisma+MySQL, Redis, BullMQ, docker-compose, env validation, logging, error envelope, Swagger, design-system primitives + layouts, health check, CI | `docker compose up` + `pnpm dev` works; lint/tests green; Storybook-like UI kit page | ✅ 2026-11-04 |
| 2 Auth & multi-tenancy | registration, login, OTP, email verify, reset, refresh rotation, sessions, 2FA, Google OAuth adapter, RBAC, tenants, TenantContext/Guard/Prisma extension, subdomain + custom-domain resolution foundation | **Tenant isolation suite green** | ✅ 2026-11-04 |
| 3 Administration | super admin dashboard (real aggregates), tenants, plans/features/prices, platform settings, admins/roles, audit logs, platform/finance/support panels (base), support tickets | e2e admin flows pass | ✅ 2026-11-04 |
| 4 Creator platform | onboarding wizard, creator dashboard, academy profile/branding, course builder + drag-and-drop curriculum, uploads (S3 multipart), staff & instructors | creator can build a full draft course | ✅ 2026-11-04 |
| 5 Student platform | student auth on academy host, catalog, free enrollment, player, progress, notes, bookmarks, discussions, quizzes, assignments, certificates (PDF + QR verify) | student completes free course and gets certificate | ⬜ |
| 6 Video infrastructure | video assets, VdoCipher/Mux/AWS adapters, processing webhooks, playback authorization, watermark, PDF protection | playback works with configured provider test account; unauthorized playback denied | ⬜ |
| 7 Commerce | products, prices, cart, checkout, coupons, orders, Razorpay/Cashfree/Stripe/PayPal adapters, webhooks, refunds, invoices, ledger, commissions, SaaS billing & dunning | full 13-step e2e journey with provider test mode | ⬜ |
| 8 Website builder | themes, templates, block page builder, versions, undo/redo, previews, blog, SEO meta injection, custom domains + TLS | creator publishes branded site on custom domain | ⬜ |
| 9 Live learning | LiveKit (primary), Zoom, Google Meet adapters, scheduling, recurring, waiting room, chat/polls/Q&A, attendance, recordings, webinars, batches/cohorts | real A/V session with attendance recorded | ⬜ |
| 10 Growth & advanced | notifications (email/SMS/WhatsApp/web-push), campaigns, automations, leads, consent, affiliates, communities, memberships, advanced analytics + exports, AI features with credits | module tests + e2e | ⬜ |
| 11 Quality & production | security audit, load tests, query optimisation, backups/restore drill, Nginx/PM2/AWS config, runbooks | release checklist signed off | ⬜ |

## Phase 1 — Foundation (✅ complete)

**Delivered**
- pnpm monorepo: `apps/api`, `apps/web`, `packages/shared`.
- **API (NestJS 12, TypeScript, ESM):** zod-validated env (fails fast; refuses dev secrets in production) · Prisma 7 + MariaDB driver adapter on MySQL 8 · first migration (`PlatformSetting`, `AuditLog`, `IdempotencyKey`) · idempotent seed · Redis client · BullMQ connection + all 12 queues registered · separate worker process with a scheduled maintenance job · pino structured logs with request IDs and secret redaction · standard `{success,data,meta}` / `{success,error}` envelope · global exception filter that hides internals · strict validation pipe (unknown fields rejected) · Redis-backed rate limiting (shared across instances) · helmet, CORS allow-list, trust-proxy · URI versioning `/api/v1` · Swagger at `/api/docs` (off in production) · health/readiness endpoints · audit-log service with secret redaction · pagination/sort helpers with allow-listed fields.
- **Web (React 19, Vite 8, Tailwind 4):** design tokens (light/dark, tenant-brandable CSS variables) · component library (Button, Input/Textarea/Select/Checkbox/Switch with accessible Field, Card/StatCard, Badge/StatusBadge, Avatar, Skeleton/Spinner/EmptyState/ErrorState, Modal/ConfirmDialog/Drawer on native `<dialog>`, Tabs, Breadcrumbs, Pagination, DataTable with server sorting + mobile cards, Dropdown, toasts) · DashboardShell (collapsible remembered sidebar, mobile drawer, ⌘K command palette, notifications, theme + language switch, profile menu, skip link) · layouts for Super Admin, Finance, Support, Creator, Student, Affiliate with full navigation (unbuilt items disabled with phase badges — no dead links) · axios client with envelope unwrapping + normalised `ApiError` · TanStack Query defaults · react-hook-form + zod pattern with server-error mapping · i18n (English, हिन्दी, ગુજરાતી) · Intl-based money/date formatting · route-level code splitting and error boundaries · System status page (live API data), Design system page, layout previews.
- **Infra:** docker-compose (MySQL 8.4, Redis 7.4, Mailpit; `--profile app` runs API/worker/web) · multi-stage Dockerfiles (API runs as non-root) · nginx SPA + API proxy config · GitHub Actions CI (lint, unit, migrate, e2e, build).

**Verification**
- Tests: shared 1 file ✅ · API unit 12 ✅ · API e2e 6 ✅ (real MySQL + Redis: health, DB-backed settings, error envelope, security headers, CORS, rate limit) · web 18 ✅ (components, form validation, shell navigation/persistence/i18n, status page, utils).
- Manual: API + worker run; health shows MySQL/Redis/queue up; worker registered repeatable job; UI checked in Chromium (desktop light/dark, mobile drawer, command palette, validation errors, mobile table).
- Docker: API and web images built and run (API in production mode refuses the dev JWT secret; Swagger disabled in production).

**Known follow-ups**
- API image is ~905 MB → slim in Phase 11 (prune Prisma engines/dev files).
- Local S3 emulation removed from compose (MinIO community images no longer published); storage set up in Phase 4/6.
- Auth guard is not active yet — all Phase 1 routes are intentionally public (`@Public`). Phase 2 enables default-deny.

## Phase 2 — Authentication & multi-tenancy (✅ complete)

**Delivered (API)**: identity/tenancy schema · creator + student registration · login with lockout and login history · TOTP 2FA (mandatory for platform admins; restricted session until enrolled; replay-protected codes) · refresh rotation with reuse detection, httpOnly cookies, CSRF double-submit, immediate revocation via Redis · email verification (link + code) · OTP service (email; SMS via Twilio/MSG91 adapters → `INTEGRATION_NOT_CONFIGURED` when unset) · password reset/change (signs out other devices) · Google OIDC + PKCE with cross-host hand-off · RBAC (33 permissions, 12 system roles, cached resolution) · host → tenant resolution (subdomain + verified custom domains, Redis cache) · CLS tenant context · tenant-scoped Prisma extension (throws without context) · Jwt/Tenant/Permissions guards (default deny) · custom domains with DNS TXT verification · seed incl. initial super admin.

**Delivered (Web)**: same-origin API proxy · AuthContext (in-memory access token, single-flight refresh, 401 retry) · route guards · login (+2FA step, safe `next`), creator signup, student register, forgot/reset, verify email, Google callback, forced admin 2FA enrolment · account security (password, 2FA with QR, sessions) · creator workspace overview and domains · student home · platform and academy landing pages · workspace switcher.

**Verification**: API unit 25 ✅ · API e2e 40 ✅ (auth 29, tenant isolation 11 incl. route-coverage check) · web 32 ✅ · browser flow: signup → SMTP-delivered verification code → domain add/verify → 2FA enrol → session restore on reload ✅.

**Fixed during verification**: OTP cooldown/invalidation keyed per account (same email in two academies) · idempotent 2FA setup (QR always matches stored secret) · unique modal title ids (a11y) · leaner request logs.

**Deferred**: composite tenant FKs land with the first tenant-owned child tables (Phase 4) · custom-domain count limit enforced by plan entitlements (Phase 3).

## Phase 3 — Administration (✅ complete)

**Delivered (API)**: subscription plans (features, limits, multi-currency monthly/annual prices; prices deactivated, never deleted) · entitlements service (subscription feature snapshot ⊕ per-tenant overrides, Redis-cached) with `@RequireFeature` / limit checks (custom domains enforced now) · default plan assignment at sign-up (trial) + backfill · tenant administration (list/search/filter/sort, detail with usage, activate, suspend → read-only workspace + academy offline + students signed out, plan change, limit overrides, deletion with typed confirmation + 30-day restore) · platform settings registry (validated, unknown keys rejected, secrets encrypted & masked) · admin management (invite by email, role changes, suspend/reactivate, last-super-admin and self-lockout protection) · audit log query API · dashboard KPIs & time series from live data (MRR/ARR per currency) · platform categories & announcements (audience-targeted) · support tickets (creator ↔ support, internal notes hidden from creators, SLA due, assignment, reports, email on reply) · creator billing overview.

**Delivered (Web)**: admin dashboard with date presets and charts · tenants list/detail with all actions · plans list/editor · settings tabs · admins · audit logs with before/after drawer · categories & announcements · support inbox, ticket view and reports · finance overview · creator billing and support · permission-filtered navigation · announcements banner · role-based landing (super/platform → /super-admin, finance → /finance, support → /support).

**Verification**: API e2e 54 ✅ (new platform-admin suite 14 incl. role boundaries) · web 36 ✅ · browser walkthrough of every admin screen without errors.

**Not yet available (by design, later phases)**: transaction revenue, commissions and settlements (Phase 7) · notification/email template management (Phase 10) · online plan purchase (Phase 7).

## Phase 4 — Creator platform (✅ complete)

**Delivered (API)**: storage service (S3 presigned PUT/GET; `local` driver for development only, refused in production) with per-purpose type/size rules, storage quota from plan, and post-upload verification of size + magic-byte signature (SVG and disguised files rejected) · academy profile/branding (logo, favicon, colours, curated fonts, social links) and business/GST profile · onboarding (10 steps) derived from saved data with publish gate (verified email, description, GST consistency, active plan) · course builder: courses, sections, lessons, one level of sub-lessons, drag-and-drop reorder endpoint validating the full tree, publish checks, scheduling (worker publishes due courses every minute), unpublish/archive/restore/delete, duplicate (deep copy), instructors · allow-listed rich-text JSON (no HTML/script) · composite tenant FKs on course tables (DB rejects cross-tenant parents) · staff invitations (new or existing accounts, email match enforced), role change, removal, owner protection, staff limit · creator dashboard from live data.

**Delivered (Web)**: creator dashboard with setup progress, plan usage and activity · onboarding wizard · academy settings (profile, branding with live preview, business & tax) · courses grid · course editor (details with rich text and media, curriculum builder with keyboard-accessible drag-and-drop and sub-lessons, lesson editor drawer with file upload, pricing & access, SEO preview, publish/schedule dialog with readiness checks) · staff management · invitation acceptance.

**Verification**: API e2e 66 ✅ (creator-platform suite 12) · web 42 ✅ · browser walkthrough: signup → onboarding with logo upload and email code → publish academy → course with text + PDF lessons → publish blocked until priced → published.

**Fixed during verification**: onboarding blockers now refresh after email verification · publish readiness check always re-runs when the dialog opens · course creation with composite keys uses one explicit transaction.

**Lesson types arriving later**: video playback (Phase 6), quizzes/assignments (Phase 5), live classes (Phase 9) — offered as disabled options in the builder; video lessons can be structured but stay unpublished until a processed video is attached.

## Change log of this file
- 2026-11-04 — Phase 0 documents drafted and approved.
- 2026-11-04 — Phase 1 foundation completed.
- 2026-11-04 — Phase 2 authentication & multi-tenancy completed.
- 2026-11-04 — Phase 3 administration completed.
- 2026-11-04 — Phase 4 creator platform completed.
