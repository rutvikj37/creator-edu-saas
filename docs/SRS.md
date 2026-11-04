# Software Requirements Specification

The functional requirements are the 20 modules of the master prompt (Super Admin, SaaS engine, onboarding, creator dashboard, course builder/LMS, video & DRM, student portal, public website, website builder, commerce, payments & subscriptions, live classes & webinars, batches, marketing, affiliates, communities & memberships, assessments, certificates, AI, finance/support/platform admin, analytics). Each is traced to design docs:

| Area | Spec document |
|---|---|
| Architecture, modules, queues, decisions | SYSTEM_ARCHITECTURE.md |
| Data model | DATABASE_ERD.md |
| APIs | API_DOCUMENTATION.md (+ Swagger) |
| Tenant isolation | MULTI_TENANCY.md |
| Security | SECURITY.md |
| Payments & subscriptions | PAYMENT_INTEGRATION.md |
| Video & DRM | VIDEO_DRM.md |
| Live learning | LIVE_CLASSES.md |
| UI/UX & navigation | UI_UX_NAVIGATION.md |
| Testing / acceptance | TESTING.md |
| Delivery plan | DEVELOPMENT_PROGRESS.md |

## Non-functional requirements
| ID | Requirement |
|---|---|
| NFR-1 | p95 API read < 500 ms at 1,000 concurrent users (k6, 100 tenants × 10k students seed) |
| NFR-2 | 99.9 % monthly availability objective; stateless API, horizontal scaling |
| NFR-3 | No media served by the app server; CDN for assets/video |
| NFR-4 | WCAG 2.1 AA; responsive 360 px → 1920 px |
| NFR-5 | OWASP ASVS L2 controls (SECURITY.md) |
| NFR-6 | i18n (en, hi, gu), multi-currency, per-tenant/user timezone, UTC storage |
| NFR-7 | Structured logs, error tracking, metrics, audit log |
| NFR-8 | RPO 15 min / RTO 4 h |

## Acceptance
Definition of Done (master prompt §37) applies to every module; status tracked in DEVELOPMENT_PROGRESS.md.
