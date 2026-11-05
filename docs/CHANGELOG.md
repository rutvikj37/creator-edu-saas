# Changelog

Format: Keep a Changelog. Versions follow SemVer once Phase 1 ships.

## [0.9.0] — 2026-11-05 — Phase 9: Live learning
### Added
- LiveKit classroom (waiting room, host controls, attendance webhooks, recordings to the video library), meeting-link classes, weekly recurrence, polls and Q&A, reminders, free webinars with ticket links, batches.
### Fixed
- JSON bodies were empty after adding the webhook content-type parser (caught by tests before release); Asia/Kolkata time zone accepted; recurring classes no longer skip the first session.

## [0.8.0] — 2026-11-05 — Phase 8 (partial): Domains, website and blog API
### Added
- Free branded subdomains alongside own domains; website pages from blocks with drafts, publishing, versions, templates; blog. Builder UI deferred.

## [0.7.0] — 2026-11-05 — Phase 7: Commerce (Razorpay)
### Added
- Academy-owned Razorpay accounts, checkout with coupons and GST, signature-verified payments, webhooks, reconciliation, refunds, invoices (FY series), ledger with plan commission, receipt/refund emails, creator orders/coupons/transactions/payments pages, student checkout and order history, platform finance overview and transactions.
### Fixed
- Gateway accounts with any payment history can no longer be deleted.
### Notes
- Razorpay only, by owner decision. No live Razorpay call was possible from the build environment.
### Added (plan billing)
- Plan checkout with proration credit and GST, renewals, reminders, past due → grace → expiry, trial expiry, cancel at period end, monthly commission invoices, platform webhook, admin subscriptions/invoices with offline payment and void.

## [0.6.0] — 2026-11-05 — Phase 6: Video (no DRM)
### Added
- Video library, multipart uploads, ranged local streaming, lesson video attach + publish checks, signed playback sessions with resume, heartbeats, auto-complete, concurrent-stream limit and revocation; creator Videos page and student video player.
### Fixed
- Final position heartbeat is sent when leaving a video lesson.
### Notes
- DRM, third-party video providers, transcoding and watermarking are out of scope by owner decision.

## [0.5.0] — 2026-11-05 — Phase 5: Student platform
### Added
- Catalogue, enrolment, player, progress, notes/bookmarks/Q&A, quizzes, assignments, certificates with verification; creator student and grading tools.

## [0.4.0] — 2026-11-04 — Phase 4: Creator platform
### Added
- File storage, academy profile & onboarding, course builder with drag-and-drop curriculum, rich text, staff invitations, creator dashboard.

## [0.3.0] — 2026-11-04 — Phase 3: Administration
### Added
- Plans & entitlements, tenant administration, settings, admins, audit logs, dashboard, categories, announcements, support tickets, finance overview, creator billing.

## [0.2.0] — 2026-11-04 — Phase 2: Authentication & multi-tenancy
### Added
- Registration, login, 2FA, refresh rotation, sessions, email/OTP verification, password flows, Google sign-in adapter, RBAC, tenant resolution and isolation, custom domains; auth UI and account security.

## [0.1.0] — 2026-11-04 — Phase 1: Foundation
### Added
- NestJS API foundation: config validation, Prisma/MySQL, Redis, BullMQ worker, health checks, error envelope, rate limiting, Swagger, audit service.
- React web foundation: design system, dashboard shell and panel layouts, API client, i18n (en/hi/gu), system status and design-system pages.
- Docker Compose, Dockerfiles, nginx config, CI workflow.
### Fixed
- `prisma generate` no longer requires `DATABASE_URL` (Docker/CI builds).
- Vite no longer bundles React development builds when the root `.env` is present (`NODE_ENV` removed from env files).

## [Unreleased]
### Added
- Phase 0 planning documents: BRD, SRS, system architecture, database ERD, API inventory, multi-tenancy, security, payments, video/DRM, live classes, deployment, testing, UI/UX navigation, roadmap.
- `.env.example` template and README.
