# Testing Strategy

Status: **Phase 0 plan**. A module is not "complete" until its tests pass in CI.

| Level | Tooling | Scope |
|---|---|---|
| Backend unit | Jest (Nest default) | services, policies, pricing/tax/commission math, ledger balancing, state machines, adapters with fixtures |
| Backend integration | Jest + Supertest + real MySQL 8 + Redis (Docker/apt), DB reset per suite | controllers end-to-end through guards, Prisma, queues (BullMQ in-process) |
| Tenant isolation | Dedicated suite generated from route registry | every tenant route × (other-tenant token, forged tenantId, cross-host realm) |
| Webhooks | Signed fixture payloads | idempotency, ordering, signature failure, amount mismatch |
| Frontend unit/component | Vitest + React Testing Library + MSW (**test-only** network stubbing) | components, forms (zod), route guards, dashboards, checkout states |
| E2E | Playwright (pre-installed Chromium) against running api+web+MySQL | the 13-step creator→student→certificate journey, plus negative paths |
| Load | k6 | 1,000 concurrent users, catalog/player/progress endpoints, p95 < 500 ms target |
| Security | `npm audit`/OSV, ZAP baseline scan, manual OWASP checklist | Phase 11 |

## E2E journey (must pass before Phase 7 sign-off; video & payment steps use provider test modes)
1 creator registers → 2 creates academy → 3 selects plan → 4 creates course → 5 uploads video → 6 publishes → 7 student registers → 8 purchases → 9 payment verified by webhook → 10 enrolled → 11 watches → 12 completes → 13 certificate issued & verifiable.

Steps 5, 8, 9, 11 need provider test credentials (VdoCipher/Mux and Razorpay/Stripe test keys). Without them those steps are reported as **skipped — not configured**, never faked.

## Coverage targets
Services ≥ 80 % lines; financial/ledger/auth/tenancy code ≥ 95 % branches.
