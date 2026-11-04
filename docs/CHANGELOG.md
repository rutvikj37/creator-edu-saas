# Changelog

Format: Keep a Changelog. Versions follow SemVer once Phase 1 ships.

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
