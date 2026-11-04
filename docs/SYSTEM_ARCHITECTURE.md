# System Architecture

Status: **Phase 0 — proposed, awaiting approval**. Nothing here is implemented yet.

## 1. Environment discovery (2026-11-04)

| Item | Found | Notes |
|---|---|---|
| Workspace | `/home/user` empty, no git repo | Project created at `/home/user/creator-edu-saas` (new git repo, **no remote yet**) |
| OS | Ubuntu 24.04.5 LTS, 4 vCPU, 15 GB RAM | |
| Node.js | v22.23.4 | LTS; target `>=22` |
| Package managers | npm 10.9.9, pnpm 10.28.0, yarn 1.22 | **pnpm workspaces** chosen |
| MySQL | not installed; `mysql-server-8.0` (8.0.46) available via apt | Docker Compose uses `mysql:8.4` LTS; cloud dev session installs 8.0 via apt |
| Redis | 7.0.15 installed | |
| Docker | CLI 29.9 + Compose v5.6 installed, **daemon not running** | `dockerd` binary present; can be started for local compose tests |
| Nginx / PM2 | not installed | Production-only concerns; added in Phase 11 |
| Latest stable libs | NestJS 12.3, Prisma Client 7.10, React 19.2, Vite 8, Tailwind 4.3, React Router 7.x, TanStack Query 5, BullMQ 5, Zod 4 | Exact versions pinned in Phase 1 |

> The container is ephemeral. Work must be pushed to a GitHub remote to persist — see "Risks".

## 2. High-level topology

```
                    ┌─────────────────────────── Browser (desktop / tablet / mobile) ───────────────────────────┐
                    │  app.platform.com (admin/creator SPA)   creator1.platform.com / learn.creator.com (academy) │
                    └───────────────┬───────────────────────────────────────────┬────────────────────────────────┘
                                    │ HTTPS                                     │ HLS/DASH segments, images
                         ┌──────────▼──────────┐                      ┌─────────▼─────────┐
                         │ Edge: Nginx (+ TLS) │                      │ CloudFront (CDN)  │──► S3 (private, OAC)
                         │  wildcard + custom  │                      │ signed URLs/cookie│    VdoCipher / Mux CDN
                         └───┬─────────────┬───┘                      └───────────────────┘
                 static SPA  │             │ /api/v1/*
              (S3/CF or nginx)             ▼
                         ┌──────────────────────────────┐     ┌──────────────────────┐
                         │  NestJS API (stateless, N×)  │◄───►│ Redis (cache, rate   │
                         │  REST /api/v1, Swagger       │     │ limit, BullMQ, locks)│
                         └──────┬───────────────┬───────┘     └─────────┬────────────┘
                                │ Prisma        │ enqueue               │
                         ┌──────▼──────┐  ┌─────▼────────────────────────▼───┐
                         │ MySQL 8.4   │◄─┤ NestJS Worker (same codebase,    │
                         │ (primary +  │  │ BullMQ processors: email, video, │
                         │ read replica│  │ webhooks, certificates, campaigns│
                         └─────────────┘  └─────────────┬────────────────────┘
                                                        │ outbound adapters
          Razorpay · Cashfree · Stripe · PayPal · SES/SMTP · MSG91/Twilio · WhatsApp Cloud API · VdoCipher · Mux
          AWS MediaConvert · LiveKit · Zoom · Google Calendar/Meet · Anthropic/OpenAI · Google OAuth
```

### Process types (one codebase, `apps/api`)
- **api** — HTTP only; never does heavy work inline.
- **worker** — BullMQ processors; scaled independently.
- **scheduler** — repeatable BullMQ jobs (renewals, reminders, drip unlocks, settlement runs). Runs as a worker with a single-leader lock.

## 3. Monorepo layout

```
creator-edu-saas/
├─ apps/
│  ├─ api/                         # NestJS (TypeScript)
│  │  ├─ prisma/                   # schema.prisma, migrations/, seed.ts
│  │  ├─ src/
│  │  │  ├─ main.ts  worker.ts
│  │  │  ├─ config/                # zod-validated env, per-integration config
│  │  │  ├─ common/                # filters, interceptors, pipes, decorators, pagination, response envelope
│  │  │  ├─ core/
│  │  │  │  ├─ prisma/             # PrismaService + tenant extension
│  │  │  │  ├─ tenancy/            # TenantContext (CLS), TenantResolver, TenantGuard, @TenantScoped
│  │  │  │  ├─ authz/              # PermissionsGuard, EntitlementGuard, @RequirePermission, @RequireFeature
│  │  │  │  ├─ queue/  cache/  storage/  mail/  logger/  audit/
│  │  │  └─ modules/               # one folder per bounded context (see §5)
│  │  │     └─ courses/
│  │  │        ├─ courses.module.ts  courses.controller.ts  courses.service.ts
│  │  │        ├─ dto/  policies/  courses.repository.ts
│  │  │        └─ __tests__/
│  │  └─ test/                     # e2e + tenant-isolation suites (supertest)
│  └─ web/                         # React (JavaScript, Vite)
│     └─ src/
│        ├─ app/                   # App.jsx, providers (QueryClient, Auth, Tenant, Theme, i18n)
│        ├─ assets/  styles/       # tailwind entry, design tokens (CSS variables)
│        ├─ components/
│        │  ├─ ui/                 # design-system primitives (Button, Input, Select, Modal, Drawer, Table…)
│        │  ├─ common/ forms/ tables/ charts/ modals/ navigation/ layout/
│        ├─ layouts/               # SuperAdminLayout, AdminLayout, CreatorLayout, StudentLayout, AffiliateLayout, PublicLayout
│        ├─ pages/                 # super-admin/ admin/ finance/ support/ creator/ student/ affiliate/ academy/
│        ├─ features/              # domain hooks + feature components (auth, tenants, courses, payments…)
│        ├─ services/api/          # axios instance, interceptors, per-domain API modules
│        ├─ hooks/  context/  utils/  schemas/ (zod)  routes/  i18n/ (en, hi, gu)
├─ packages/
│  └─ shared/                      # JS constants shared by api+web: permission keys, feature keys, enums, order states
├─ infra/
│  ├─ docker/                      # Dockerfiles (api, worker, web)
│  ├─ nginx/                       # wildcard + custom-domain server blocks
│  └─ pm2/ecosystem.config.js
├─ docs/
├─ docker-compose.yml  .env.example  README.md  pnpm-workspace.yaml
```

**Why a single web SPA for all panels:** shared design system, one auth client, route-level code-splitting keeps each panel's bundle separate. The SPA decides which "surface" to render from the hostname:
- `app.<platform>` / `admin.<platform>` → platform, admin and creator panels.
- `<slug>.<platform>` or a verified custom domain → academy surface (public site + student portal + affiliate panel).

**SEO for public academy pages:** the API exposes `GET /api/v1/public/seo?path=` and Nginx/an edge function serves `index.html` with per-tenant `<title>`, meta, OpenGraph and JSON-LD injected (server-side meta injection). A full Vite SSR renderer for academy pages is an option in Phase 8 if crawl tests show it is needed. (Decision D-7.)

## 4. Request lifecycle & tenant resolution

1. Nginx forwards `Host` → API reads `X-Forwarded-Host` (trusted proxy only).
2. `TenantResolverMiddleware`: host → `TenantDomain` (verified) or `<slug>.<rootDomain>` → `tenantId` (Redis-cached 60 s, invalidated on change).
3. `JwtAuthGuard`: verifies access token; token carries `sub`, `realm` (`platform` | tenant id), `tid` (active tenant workspace for platform users), `sid` (session id).
4. `TenantGuard`: final tenant = host-resolved tenant (academy surface) **or** the token's active workspace (creator panel), and is accepted only if the user has a membership/realm match. Mismatch → 404 (not 403, to avoid enumeration).
5. Tenant id stored in **AsyncLocalStorage (nestjs-cls)**. A Prisma client extension auto-injects `tenantId` into `where`/`data` for all tenant-owned models and throws if a tenant-owned query runs without context (except in explicitly marked `@CrossTenant()` super-admin services).
6. `PermissionsGuard` (RBAC) → `EntitlementGuard` (plan features/limits) → controller → service.
7. `AuditInterceptor` records sensitive mutations; `ResponseInterceptor` wraps `{ success, data, meta }`; `AllExceptionsFilter` maps errors to `{ success:false, error:{ code, message, details? } }` with no stack/SQL leakage.

Details: [MULTI_TENANCY.md](MULTI_TENANCY.md).

## 5. Backend module map (bounded contexts)

| Group | Modules | Phase |
|---|---|---|
| Core | config, prisma, tenancy, authz, queue, cache, storage, mail, logger, audit-logs, files, health | 1 |
| Identity | auth (password, OTP, Google, refresh rotation, 2FA), users, roles, permissions, sessions | 2 |
| SaaS | tenants, domains, subscriptions (plans, features, usage), entitlements | 2–3 |
| Administration | super-admin, admin (platform), finance, support, support-tickets, settings, categories, announcements | 3 |
| Creator | academy, onboarding, staff, instructors, creator-dashboard | 4 |
| LMS | courses, curriculum (sections/lessons), lessons, resources, enrollments, progress, reviews, bookmarks, notes, discussions | 4–5 |
| Assessment | quizzes (question bank, attempts, grading), assignments | 5 |
| Certificates | templates, issuance, PDF, verification | 5 |
| Video | video (assets, uploads, providers), drm (license/playback tokens), watermark, pdf-protection | 6 |
| Commerce | products, prices, cart, checkout, orders, payments (adapters), refunds, invoices, coupons, ledger, settlements, payouts, tax | 7 |
| Website | websites (pages, blocks, versions, themes, templates), domains (verification, SSL), seo, blog | 8 |
| Live | live-classes, sessions, attendance, recordings, webinars, cohorts (batches) | 9 |
| Growth | marketing (campaigns, templates, segments, automations), leads, affiliates, communities, memberships | 10 |
| Intelligence | analytics (aggregations, exports), ai (providers, credits, RAG), notifications (in-app/email/SMS/WhatsApp/web-push) | 10 |

Each module: controller(s) → service (business rules) → repository (Prisma, tenant-aware) + DTOs (class-validator / zod) + policies + tests.

## 6. Background queues (BullMQ)

| Queue | Jobs |
|---|---|
| `notifications` | render template, send email / SMS / WhatsApp / web-push, in-app fan-out |
| `video` | create provider asset, poll/receive processing status, thumbnail, subtitle ingestion |
| `webhooks-in` | process verified provider webhook events (payments, video, live) idempotently |
| `commerce` | enrollment fulfilment, invoice PDF, refund processing, commission calculation, abandoned-checkout detection |
| `billing` | subscription renewals, dunning, grace-period expiry, usage roll-ups |
| `certificates` | eligibility check, PDF render, email |
| `marketing` | campaign batching (rate-limited per channel), automation steps (delayed jobs) |
| `live` | reminders, attendance reconciliation, recording import |
| `analytics` | daily aggregate snapshots, CSV/PDF export generation |
| `ai` | long-running generation, document embedding |
| `domains` | DNS verification polling, certificate provisioning |

All jobs carry `tenantId` and re-establish tenant context in the processor.

## 7. Storage & media

- S3 buckets: `*-private` (videos source, PDFs, submissions, invoices — Block Public Access, SSE-KMS), `*-public-assets` (logos, thumbnails, site images — still served only via CloudFront OAC).
- Uploads go **browser → S3 directly** via presigned multipart URLs; the API never proxies large files.
- Downloads via short-lived CloudFront signed URLs (or S3 presigned GET), issued only after entitlement checks.
- Video delivery is never through the app server. See [VIDEO_DRM.md](VIDEO_DRM.md).

## 8. Integration adapter pattern

Every external provider implements a TypeScript interface (e.g. `PaymentProvider`, `VideoProvider`, `LiveProvider`, `MessageChannel`, `AiProvider`, `DnsVerifier`). A registry resolves the adapter from tenant/platform config. If credentials are missing, the adapter reports `status: 'not_configured'`; the API returns `409 INTEGRATION_NOT_CONFIGURED` and the UI shows a clear "Not configured — set up in Integrations" state. **No adapter ever simulates success.**

## 9. Observability

- Structured JSON logs (pino via `nestjs-pino`) with `requestId`, `tenantId`, `userId`; secrets redacted.
- Error tracking: Sentry adapter (optional DSN).
- Metrics: `/metrics` Prometheus endpoint (internal only); health `/api/v1/health` (db, redis, queue).
- Audit log in MySQL for security/business events (append-only).

## 10. Key architecture decisions (for approval)

| # | Decision | Rationale |
|---|---|---|
| D-1 | pnpm monorepo: `apps/api` (NestJS **TypeScript**), `apps/web` (React **JavaScript** + Vite), `packages/shared` | Prompt stack; TS preferred for backend |
| D-2 | Shared MySQL schema, `tenantId` column on every tenant-owned row, **composite tenant-aware foreign keys** `(tenantId, xId) → (tenantId, id)` | DB-level guarantee that children cannot point at another tenant's rows |
| D-3 | Primary keys: `CHAR(25)` CUIDs (`@default(cuid())`) | Non-enumerable public IDs, safe in URLs, sortable enough |
| D-4 | Two identity realms: **platform** users (admins, creators, creator staff) and **tenant** users (students, affiliates — scoped per academy, `UNIQUE(realmKey, email)`) | Matches Graphy-style per-academy learner accounts; no cross-tenant account leakage |
| D-5 | Auth: short-lived access JWT (15 min, memory only) + rotating refresh token in httpOnly Secure SameSite=Lax cookie, hashed in DB, reuse detection revokes the session family; CSRF double-submit token on cookie endpoints | OWASP guidance |
| D-6 | Money: `DECIMAL(19,4)` + explicit `CHAR(3)` currency; double-entry ledger for all financial movements | Required precision + auditability |
| D-7 | Public academy SEO via server-side meta injection first; Vite SSR for academy routes if needed | Keeps one React stack |
| D-8 | Custom-domain TLS: Nginx edge + automated certificate issuance (ACME/certbot driven by `domains` queue) **or** AWS CloudFront multi-tenant (SaaS Manager) — final choice in Phase 8 | Both work on AWS; depends on expected custom-domain volume |
| D-9 | RAG embeddings: stored per tenant in MySQL (JSON/`VECTOR` when on MySQL 9.x) with in-app similarity for MVP | Avoids introducing a second database; revisit at scale |
| D-10 | i18n with `react-i18next` (en, hi, gu); all currency/date formatting through `Intl` with tenant/user locale + timezone | No hardcoded symbols |

## 11. Dependencies

**api (NestJS/TS):** `@nestjs/{core,common,platform-express,config,swagger,throttler,jwt,passport,schedule,terminus}`, `prisma` + `@prisma/client` (7.x), `nestjs-cls`, `class-validator`, `class-transformer`, `zod` (env), `argon2`, `otplib`, `passport-jwt`, `passport-google-oauth20`, `ioredis`, `bullmq` + `@nestjs/bullmq`, `nestjs-pino`, `helmet`, `cookie-parser`, `@aws-sdk/{client-s3,s3-request-presigner,cloudfront-signer,client-mediaconvert,client-ses}`, `razorpay`, `stripe`, `@paypal/paypal-server-sdk`, Cashfree PG SDK, `@mux/mux-node`, `livekit-server-sdk`, `nodemailer`, `handlebars`/`mjml` (templates), `pdf-lib` + `@react-pdf/renderer` or Puppeteer (invoices/certificates), `qrcode`, `sanitize-html`, `rrule`, `web-push`, `@anthropic-ai/sdk`, `openai` (optional), `@sentry/node`. Dev: `jest`, `supertest`, `@nestjs/testing`, `eslint`, `prettier`.

**web (React/JS):** `react`, `react-dom`, `react-router`, `@tanstack/react-query`, `axios`, `react-hook-form`, `@hookform/resolvers`, `zod`, `tailwindcss` (v4) + `@tailwindcss/vite`, `lucide-react`, `recharts`, `@tiptap/react` + starter-kit, `@dnd-kit/core` + `@dnd-kit/sortable` (curriculum & builder drag-and-drop), `react-i18next` + `i18next`, `date-fns`, `dompurify`, `hls.js` / provider players (VdoCipher iframe API, `@mux/mux-player-react`), `livekit-client` + `@livekit/components-react`, `qrcode.react`, `sonner` (toasts), `clsx` + `tailwind-merge`. Dev: `vite`, `vitest`, `@testing-library/react`, `msw` (tests only), `@playwright/test`, `eslint`.

**Infra:** MySQL 8.4, Redis 7, MinIO + Mailpit (dev only), Nginx, PM2, Docker.

## 12. External accounts needed (by phase)

| Phase | Account / credential | Needed for |
|---|---|---|
| 1–2 | none (local MySQL/Redis/Mailpit) | foundation, auth |
| 2 | Google Cloud OAuth client (optional) | Google login |
| 2/10 | SMTP or AWS SES; MSG91/Twilio; WhatsApp Business (Meta) | email / SMS OTP / WhatsApp |
| 4/6 | AWS account: S3 buckets, CloudFront key pair, IAM user/role, MediaConvert | uploads, delivery |
| 6 | VdoCipher **and/or** Mux account (DRM-enabled plan for real DRM) | video protection |
| 7 | Razorpay, Cashfree, Stripe, PayPal test/live keys + webhook secrets | payments |
| 8 | DNS for root domain (wildcard), certificate automation | subdomains, custom domains |
| 9 | LiveKit Cloud (or self-host), Zoom Marketplace app, Google Workspace for Meet | live classes |
| 10 | Anthropic (default) / OpenAI API key | AI features |

## 13. Technical risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Scope is very large (20 modules) | Schedule | Strict phase gates; each phase shippable; DoD enforced |
| Cross-tenant data leak | Critical | 4-layer isolation, composite FKs, generated isolation test suite as CI gate |
| DRM claims without provider | Legal/trust | Capability matrix; DRM badge only when provider verified |
| Payment correctness (duplicate/out-of-order webhooks) | Financial | Idempotent `WebhookEvent`, server-side re-fetch, ledger balancing in transactions, reconciliation job |
| Split settlements need provider approval | Business | Creator-owned keys first; marketplace split behind flag |
| Custom-domain TLS at scale | Ops | Decide D-8 in Phase 8; automate issuance/renewal; alerts on expiry |
| SPA SEO for academies | Growth | Meta injection; SSR fallback (D-7) |
| Google Meet can't be embedded / limited attendance | Feature parity | Documented; LiveKit as primary embedded provider |
| MySQL 8 has no vector type | AI search quality at scale | Per-tenant small corpora in app memory; MySQL 9 `VECTOR` upgrade path |
| Ephemeral cloud container, no git remote | Lost work | **Attach a GitHub repository** and push after every milestone |
| Docker daemon not running in this session | Compose untested here | Start `dockerd` or use apt MySQL 8.0 + local Redis for tests |
| Third-party SDK/API changes | Breakage | Adapters isolate providers; pinned versions; contract tests on fixtures |
