# Development Progress & Roadmap

Legend: ⬜ not started · 🟨 in progress · ✅ done (meets Definition of Done) · ⏸ blocked

| Phase | Scope | Exit criteria | Status |
|---|---|---|---|
| 0 Discovery & planning | env inspection, architecture, ERD, module map, navigation, roadmap, docs | Docs approved by owner | ✅ approved 2026-11-04 |
| 1 Foundation | pnpm monorepo, NestJS api+worker, React/Vite/Tailwind web, Prisma+MySQL, Redis, BullMQ, docker-compose, env validation, logging, error envelope, Swagger, design-system primitives + layouts, health check, CI | `docker compose up` + `pnpm dev` works; lint/tests green; Storybook-like UI kit page | ✅ 2026-11-04 |
| 2 Auth & multi-tenancy | registration, login, OTP, email verify, reset, refresh rotation, sessions, 2FA, Google OAuth adapter, RBAC, tenants, TenantContext/Guard/Prisma extension, subdomain + custom-domain resolution foundation | **Tenant isolation suite green** | ⬜ |
| 3 Administration | super admin dashboard (real aggregates), tenants, plans/features/prices, platform settings, admins/roles, audit logs, platform/finance/support panels (base), support tickets | e2e admin flows pass | ⬜ |
| 4 Creator platform | onboarding wizard, creator dashboard, academy profile/branding, course builder + drag-and-drop curriculum, uploads (S3 multipart), staff & instructors | creator can build a full draft course | ⬜ |
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

## Change log of this file
- 2026-11-04 — Phase 0 documents drafted and approved.
- 2026-11-04 — Phase 1 foundation completed.
