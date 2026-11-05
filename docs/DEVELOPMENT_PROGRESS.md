# Development Progress & Roadmap

Legend: ⬜ not started · 🟨 in progress · ✅ done (meets Definition of Done) · ⏸ blocked

| Phase | Scope | Exit criteria | Status |
|---|---|---|---|
| 0 Discovery & planning | env inspection, architecture, ERD, module map, navigation, roadmap, docs | Docs approved by owner | ✅ approved 2026-11-04 |
| 1 Foundation | pnpm monorepo, NestJS api+worker, React/Vite/Tailwind web, Prisma+MySQL, Redis, BullMQ, docker-compose, env validation, logging, error envelope, Swagger, design-system primitives + layouts, health check, CI | `docker compose up` + `pnpm dev` works; lint/tests green; Storybook-like UI kit page | ✅ 2026-11-04 |
| 2 Auth & multi-tenancy | registration, login, OTP, email verify, reset, refresh rotation, sessions, 2FA, Google OAuth adapter, RBAC, tenants, TenantContext/Guard/Prisma extension, subdomain + custom-domain resolution foundation | **Tenant isolation suite green** | ✅ 2026-11-04 |
| 3 Administration | super admin dashboard (real aggregates), tenants, plans/features/prices, platform settings, admins/roles, audit logs, platform/finance/support panels (base), support tickets | e2e admin flows pass | ✅ 2026-11-04 |
| 4 Creator platform | onboarding wizard, creator dashboard, academy profile/branding, course builder + drag-and-drop curriculum, uploads (S3 multipart), staff & instructors | creator can build a full draft course | ✅ 2026-11-04 |
| 5 Student platform | student auth on academy host, catalog, free enrollment, player, progress, notes, bookmarks, discussions, quizzes, assignments, certificates (PDF + QR verify) | student completes free course and gets certificate | ✅ 2026-11-05 |
| 6 Video (no DRM — scope set by owner 2026-11-05) | video library, direct + multipart uploads, signed playback sessions, resume, auto-complete, concurrent-stream limit, revocation | student plays an attached video; unauthorized playback denied | ✅ 2026-11-05 |
| 7 Commerce (Razorpay only — owner decision 2026-11-05) | Razorpay gateway per academy, checkout, coupons, GST, orders, webhooks, reconciliation, refunds, invoices, ledger, commission recording, finance views | paid checkout → access → invoice → refund, verified against Razorpay's API contract | ✅ 2026-11-05 (SaaS plan billing pending) |
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

## Phase 5 — Student platform (✅ complete)

**Delivered (API)**: public catalogue + course landing with outline (content never exposed) and free previews · enrolment (free, manual grant incl. invited accounts; purchase grants arrive with Phase 7) with access expiry · player with drip (days-after-enrol / dates; lesson overrides section), lock state and resume · lesson content with short-lived signed file URLs · progress + completion threshold over required lessons · notes, bookmarks, lesson Q&A with instructor replies and moderation · quizzes: 7 question types, shuffling, random pick, time limit with grace, attempt limits, negative marking, auto + manual grading, results visibility · assignments: rich-text instructions, due dates/late policy, student uploads (signature-verified), resubmission, grading/return · certificates: per-tenant template, idempotent issuance on completion, PDF with QR, public verification (any host), revoke/reinstate · creator students list/detail, course enrolments, discussions.

**Delivered (Web)**: academy home with live catalogue · course landing (objectives, outline, preview modal, enrol CTA) · My learning · full-screen player (curriculum with lock/complete states, content renderers per type, notes and Q&A panels, prev/next, bookmark, mark complete) · quiz runner (timer, autosave, results with feedback) · assignment panel (attachments) · certificates with PDF download · public verification page · creator: students, discussions, certificates (template + issued), quiz builder and grading, assignment editor and grading, course Students tab.

**Verification**: API e2e 69 ✅ (student-platform suite 3 incl. full journey, access rules, isolation) · API unit 43 ✅ (grading, access rules, certificate numbers) · web 48 ✅ · browser journey: academy → preview → sign up → enrol → complete → quiz pass → assignment → certificate PDF → public verification.

**Fixed during verification**: sign-up/sign-in now return to the `?next=` page (guest guard no longer overrides it) · creator attempt detail endpoint for grading.

**Deferred**: standalone question bank (questions live per quiz) · course reviews/ratings (Phase 10 with communities).

## Phase 6 — Video (✅ complete, no DRM)

**Scope decision (owner, 2026-11-05)**: "video only, not DRM". Out of scope: VdoCipher/Mux/MediaConvert adapters, HLS transcoding, Widevine/FairPlay, watermarking, PDF protection. The UI says plainly that playback is not DRM.

**Delivered (API)**: `VideoAsset` library per tenant (title, source file, duration, status, usage) · uploads reuse the verified file pipeline; files over 100 MB on S3 use multipart (8 MiB parts, signed per part, Redis-held upload id) · local driver serves HTTP `Range` (206/416) so seeking works in dev · lesson attach (VIDEO lessons only, READY, same tenant; duration copied) and publish checks require a ready video · playback sessions: enrolment/drip/expiry checks, short-lived signed URL (TTL scales with duration, 30 min–6 h), resume position, at most 3 concurrent streams per student (429), heartbeat re-checks access every 15 s and revokes on lost enrolment (403), auto-complete at 90 % watched, explicit end · deleting a video in use is refused (409); deleting revokes live sessions · both new tables are tenant-scoped and covered by the isolation suite.

**Delivered (Web)**: Videos page (drag-and-drop upload queue with progress, parallel multipart parts with retry, library table, preview modal, delete confirm) · lesson editor video picker · student `VideoPlayer` (session start, resume, heartbeats, auto-complete, revoked/limit errors, ends session on leave).

**Verification**: API e2e 71 ✅ (video suite: upload → attach → publish → play → resume → auto-complete, device limit, revocation, isolation) · API unit 45 ✅ · web 52 ✅ (VideoPlayer: session lifecycle, completion, revocation, start errors) · browser: creator uploads MP4 in the UI → preview plays → attach → student enrols → player loads 40 s video → watching to the end marks lesson Completed, course 100 %.

**Fixed during verification**: final heartbeat on leaving the lesson was skipped (ref already detached) — now uses the last observed position · small files showed "0 MB".

## Phase 7 — Commerce with Razorpay (✅ complete; SaaS plan billing pending)

**Scope decisions (owner, 2026-11-05)**: Razorpay is the only gateway ("give only razorpay option now"). Cashfree, Stripe and PayPal are not built; the adapter interface remains so they can be added later. Merchant model is **creator-owned**: each academy connects its own Razorpay account and money settles directly to it, so platform settlements/payouts do not apply.

**Delivered (API)**: Razorpay account per academy — keys AES-256-GCM encrypted, never returned, verified against Razorpay before selling (rejected keys vs unreachable reported separately) · checkout quote and order creation with coupons (percent/fixed, course scope, dates, total and per-student limits, minimum price) and GST (inclusive or exclusive, slab from business settings, only when GST-registered) · `Idempotency-Key` on checkout · Razorpay Orders API + Checkout.js; confirmation verifies the checkout signature and re-reads the payment from Razorpay (authorized payments are captured), never trusting the browser · webhooks verified with HMAC over the raw body, stored once per event id, processed in the worker by re-reading state from Razorpay (duplicates and out-of-order events are harmless) · fulfilment in one transaction guarded by a conditional status update: order PAID, enrolment, coupon redemption, ledger (sale, GST, Razorpay fee, plan commission), invoice numbered per Indian financial year · amount/currency mismatch never grants access · reconciliation every 5 minutes re-reads unsettled payments and refunds and expires unpaid orders after 2 h (late captures still fulfil) · 100% coupons complete without Razorpay · full and partial refunds through Razorpay with GST and commission reversals and optional access revocation (full refunds only), pending refunds settled by webhook or reconciliation · invoice PDFs · receipt and refund emails · platform finance overview (GMV, refunds, commission owed) and cross-academy transactions.

**Delivered (Web)**: creator Payments page (connect keys, webhook setup with copyable URL, pause/resume, re-check, disconnect) · GST rate and inclusive/exclusive pricing in business settings · Coupons · Orders with revenue summary · order detail with payments, refunds, ledger, refund dialog and invoice · Transactions · student Buy now → Checkout (billing details, optional GSTIN, coupon, GST breakdown) → Razorpay Checkout.js → order status page that polls until confirmed → order history with invoices · finance dashboard with academy sales and a transactions page.

**Verification**: API unit 60 ✅ (Razorpay adapter with real HMAC signatures and recorded response shapes, pricing/GST maths) · API e2e 74 ✅ (commerce suite: gateway setup, coupon + GST checkout, forged signature, webhook-only payment, invalid/duplicate webhooks, decline and retry, amount mismatch, reconciliation capture, expiry, 100% coupon, partial/pending/full refunds with revocation, ledger and summary figures, finance permissions, cross-academy isolation; isolation suite covers every new creator route) · web 63 ✅ · browser: creator connects keys (shown as "couldn't verify" because Razorpay is unreachable here), creates coupons, student sees GST checkout, applies coupons, completes a 100%-coupon purchase, downloads the invoice, opens the course; creator sees the order.

**Not verified here**: a live payment against Razorpay. This environment's network policy blocks `api.razorpay.com` and `checkout.razorpay.com`; the e2e suite runs the production adapter against an in-memory implementation of Razorpay's documented API. Before going live: run one test-mode purchase and refund with real `rzp_test_` keys and a configured webhook.

**Fixed during verification**: gateway deletion was allowed once payments were refunded (now blocked whenever payments exist) · the payments page called an unreachable Razorpay "rejected keys" · ₹0 orders said "Payment successful".

**Pending / not in this phase**: SaaS plan billing and dunning (creators paying the platform for plans and collecting commission) · multi-course cart and bundles · GST reports/exports (Phase 10) · Content-Security-Policy, if one is added, must allow `checkout.razorpay.com` (script/frame) and `api.razorpay.com` (connect).

## Change log of this file
- 2026-11-04 — Phase 0 documents drafted and approved.
- 2026-11-04 — Phase 1 foundation completed.
- 2026-11-04 — Phase 2 authentication & multi-tenancy completed.
- 2026-11-04 — Phase 3 administration completed.
- 2026-11-04 — Phase 4 creator platform completed.
- 2026-11-05 — Phase 5 student platform completed.
- 2026-11-05 — Phase 6 video (no DRM) completed.
- 2026-11-05 — Phase 7 commerce (Razorpay) completed; SaaS plan billing pending.
