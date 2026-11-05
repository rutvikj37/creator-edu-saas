# Changelog

Format: Keep a Changelog. Versions follow SemVer once Phase 1 ships.

## [0.16.0] — 2026-11-05 — Paid webinars
### Added
- Webinar tickets: set a price, sell through Razorpay checkout with coupons and GST; the join link is emailed after payment; refunds can cancel the ticket.

## [0.15.0] — 2026-11-05 — Cart and course bundles
### Added
- Course bundles: several courses at one price with the saving shown, on the catalogue and their own page; creators manage them under Bundles.
- Cart: students add paid courses and bundles and pay for them in one Razorpay order; coupons apply to the eligible items, GST on the order, one invoice; refunds can revoke every course bought.
### Fixed
- Ownership checks during checkout no longer pass the array index as the current time (found while adding the cart).

## [0.14.0] — 2026-11-05 — plugNmeet live classes and webinars
### Added
- plugNmeet classroom for live classes and webinars (self-hosted plugNmeet server): rooms created from the class settings (waiting room, automatic cloud recording, capacity, webinar attendee locks, whiteboard, shared notes, polls, breakout rooms), secure join tokens after the academy's access checks, attendance from plugNmeet webhooks and a per-minute sync, host end, and recordings imported into the video library (Bunny Stream) for students to watch.
### Changed
- Recording playback for live sessions supports Bunny-hosted recordings (token-signed player).

## [0.13.0] — 2026-11-05 — Website drag-and-drop page builder
### Added
- Full-screen page builder for the home page and extra pages: drag blocks from a palette, reorder, hide, duplicate, delete, edit every field in an inspector, undo/redo, desktop/mobile preview, page settings and SEO, save, preview, publish, unpublish and version restore, with an unsaved-changes guard.
- Website page lists all pages with menu toggle and drag-to-reorder menu order, use as home page and delete; new pages start from a blank or ready-made layout.
### Changed
- Block validation errors use plain language and are shown on the exact block and field.

## [0.12.0] — 2026-11-05 — Academy website: own website or AI landing page
### Added
- Website mode per academy: connect an existing website (academy home redirects; courses, checkout and learning stay on the platform; link kit with buy buttons) or an AI-generated landing page from the academy profile, courses and industry (English, Hindi, Gujarati), saved as an editable draft with live preview, history and publish.
- Public academy home renders the published landing page with search-engine title and description.

## [0.11.0] — 2026-11-05 — Video management & processing
### Added
- Bunny Stream provider (provider-neutral interface): direct resumable browser uploads with short-lived credentials, webhook handling verified against the Bunny API, status history, timeouts, retries, cleanup; token-authenticated playback with resume and progress.
- Encrypted (AES-256-GCM) Google Drive backups of original videos and course documents with checksum verification, retries, quota monitoring and verified restore.
- Video usage tracking with configurable provider rates; Super Admin Video usage and Backups pages; creator video library redesign.
### Fixed
- Filenames in Indic scripts kept intact; large sizes shown in TB; BigInt sizes in video details serialised correctly.

## [0.10.0] — 2026-11-05 — Phase 10: Growth & advanced
### Added
- Notifications (in-app, email, web push, SMS/WhatsApp adapters) with preferences; contacts with consent; email campaigns and automations; affiliate program with held commissions and payouts; communities with moderation; memberships sold through checkout; analytics, CSV exports and a GST report; AI features (course outline, lesson draft, quiz questions, student study assistant) metered by monthly plan credits.
### Changed
- Default AI model is `claude-opus-5-5` (override with `ANTHROPIC_MODEL`).
### Fixed
- Affiliate commission on repeated partial refunds is recomputed from the original sale instead of compounding.

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
