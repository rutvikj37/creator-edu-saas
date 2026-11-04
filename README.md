# Creator Education SaaS Platform

Multi-tenant platform for creators to launch branded academies: courses, video, live classes, payments, marketing, affiliates, communities and certificates.

**Stack:** React (JS, Vite, Tailwind, React Router, TanStack Query, React Hook Form, Zod, Recharts, Lucide, TipTap) · NestJS (TypeScript) · Prisma · MySQL 8.4 · Redis + BullMQ · AWS S3/CloudFront · Docker/Nginx/PM2.

## Status
Phase 0 (architecture & planning) — see [docs/DEVELOPMENT_PROGRESS.md](docs/DEVELOPMENT_PROGRESS.md). No application code yet.

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
Available from Phase 1 (`docker compose up -d`, `pnpm install`, `pnpm dev`).
