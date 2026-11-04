# Development Progress & Roadmap

Legend: ⬜ not started · 🟨 in progress · ✅ done (meets Definition of Done) · ⏸ blocked

| Phase | Scope | Exit criteria | Status |
|---|---|---|---|
| 0 Discovery & planning | env inspection, architecture, ERD, module map, navigation, roadmap, docs | Docs approved by owner | 🟨 awaiting approval |
| 1 Foundation | pnpm monorepo, NestJS api+worker, React/Vite/Tailwind web, Prisma+MySQL, Redis, BullMQ, docker-compose, env validation, logging, error envelope, Swagger, design-system primitives + layouts, health check, CI | `docker compose up` + `pnpm dev` works; lint/tests green; Storybook-like UI kit page | ⬜ |
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

## Change log of this file
- 2026-11-04 — Phase 0 documents drafted.
