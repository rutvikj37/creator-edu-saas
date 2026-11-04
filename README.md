# Creator Education SaaS Platform

Multi-tenant platform for creators to launch branded academies: courses, video, live classes, payments, marketing, affiliates, communities and certificates.

**Stack:** React (JS, Vite, Tailwind, React Router, TanStack Query, React Hook Form, Zod, Recharts, Lucide, TipTap) · NestJS (TypeScript) · Prisma · MySQL 8.4 · Redis + BullMQ · AWS S3/CloudFront · Docker/Nginx/PM2.

## Status
Phase 1 (foundation) complete — see [docs/DEVELOPMENT_PROGRESS.md](docs/DEVELOPMENT_PROGRESS.md).

## Documentation
| Doc | Purpose |
|---|---|
| [BRD](docs/BRD.md) · [SRS](docs/SRS.md) | Business & software requirements |
| [System architecture](docs/SYSTEM_ARCHITECTURE.md) | Topology, folder structure, module map, decisions |
| [Database ERD](docs/DATABASE_ERD.md) | Full relational model |
| [API](docs/API_DOCUMENTATION.md) | Conventions & endpoint inventory |
| [Multi-tenancy](docs/MULTI_TENANCY.md) · [Security](docs/SECURITY.md) | Isolation & security controls |
| [Payments](docs/PAYMENT_INTEGRATION.md) · [Video/DRM](docs/VIDEO_DRM.md) · [Live](docs/LIVE_CLASSES.md) | Integrations |
| [UI/UX & navigation](docs/UI_UX_NAVIGATION.md) | Design system & every panel's menu |
| [Deployment](docs/DEPLOYMENT.md) · [Testing](docs/TESTING.md) | Ops & QA |

## Getting started

Requirements: Node.js 22+, pnpm 10 (`corepack enable`), Docker Desktop (or local MySQL 8 + Redis 7).

```bash
cp .env.example .env          # then set JWT_ACCESS_SECRET, ENCRYPTION_KEY, CSRF_SECRET
docker compose up -d          # MySQL 8.4, Redis 7, Mailpit
pnpm install
pnpm db:migrate               # apply Prisma migrations
pnpm db:seed                  # default platform settings
pnpm dev                      # API :4000 + web :5173
pnpm dev:worker               # background jobs (separate terminal)
```

Open http://app.lvh.me:5173 (`*.lvh.me` resolves to 127.0.0.1, so tenant subdomains work locally).
API docs: http://localhost:4000/api/docs · Health: http://localhost:4000/api/v1/health · Mail: http://localhost:8025

Generate secrets: `openssl rand -base64 48` (JWT/CSRF) and `openssl rand -base64 32` (ENCRYPTION_KEY).

| Command | Purpose |
|---|---|
| `pnpm lint` | Type-check API, lint web |
| `pnpm test` | Unit/component tests (all packages) |
| `pnpm test:e2e` | API integration tests against `creator_edu_test` (MySQL + Redis required) |
| `pnpm build` | Production builds |
| `docker compose --profile app up --build` | Run API, worker and web in containers |

## Repository layout
```
apps/api        NestJS API + BullMQ worker (TypeScript, Prisma, MySQL)
apps/web        React SPA (Vite, Tailwind, TanStack Query)
packages/shared Constants shared by API and web (roles, feature keys, error codes)
infra/          Dockerfiles, nginx
docs/           Architecture & specifications
```
