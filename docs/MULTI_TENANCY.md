# Multi-Tenancy

Status: **Phase 0 design**.

## Model
Shared MySQL database, shared schema, `tenantId` discriminator on every tenant-owned table, enforced in **four layers**:

| Layer | Mechanism |
|---|---|
| 1. Resolution | `TenantResolverMiddleware` maps the verified request host → tenant. Platform hosts (`app.`, `admin.`, `api.`) resolve to no tenant. |
| 2. Authorization | `TenantGuard` decides the effective tenant from (a) host tenant for academy-realm users, or (b) the JWT's active workspace `tid` for platform users with a `TenantMember` row. Any `tenantId` in body/query/params is **ignored** (DTOs strip it via whitelist). |
| 3. Data access | `TenantContext` (nestjs-cls / AsyncLocalStorage). A Prisma client extension adds `tenantId` to every `find*`, `count`, `aggregate`, `update*`, `delete*` `where` and every `create*` `data` for models listed in `TENANT_MODELS`; it throws `TenantContextMissingError` if no context and the call isn't wrapped in `runAsPlatform()` (super-admin only). Raw SQL is banned outside reviewed repository files. |
| 4. Database | Composite FKs `(tenantId, parentId) → parent(tenantId, id)`; composite uniques prefixed with `tenantId`. |

## Identity realms
- **Platform realm** (`realmKey = 'platform'`): super admin, platform/finance/support admins, creators, creator staff. A platform user can belong to several tenants (`TenantMember`) and switches workspace via `POST /api/v1/auth/switch-tenant` which mints a new access token with `tid`.
- **Tenant realm** (`realmKey = <tenantId>`): students and affiliates of one academy. Same email in two academies = two independent accounts. Tokens issued on host A are rejected on host B (the `realm` claim must equal the host tenant).

## Domains
- Default: `<slug>.<PLATFORM_ROOT_DOMAIN>` (wildcard DNS + wildcard TLS).
- Branded subdomains (Phase 8): creators may add up to 3 `<name>.<PLATFORM_ROOT_DOMAIN>` addresses (stored as `TenantDomain` type SUBDOMAIN, VERIFIED immediately). Resolution checks these before slugs; names are unique across slugs and subdomains.
- Custom: creator adds `learn.creator.com` → we show `CNAME learn → tenants.<root>` and `TXT _ce-verify.learn → <token>`; `domains` queue polls DNS; on success status `VERIFIED`, TLS issued (see SYSTEM_ARCHITECTURE D-8), then the domain becomes routable. Unverified hosts get a neutral 404 page.
- Plan entitlement `domains.custom` limits the number of custom domains.

## Entitlements & limits
`EntitlementService.get(tenantId)` = active subscription's `featureSnapshot` ⊕ `TenantLimitOverride`, cached in Redis. `@RequireFeature('live_classes')` and `assertWithinLimit('courses.max')` used in services. Suspended or expired tenants: academy shows a "temporarily unavailable" page, creator panel is read-only except Billing.

## Background jobs
Every job payload includes `tenantId`; processors call `tenantContext.run(tenantId, fn)`. Cross-tenant jobs (renewals sweep) iterate tenants explicitly.

## Caching
All cache keys prefixed `t:{tenantId}:`. Public academy responses are cached by host.

## Required tests (Phase 2 gate)
- For every tenant-scoped controller route: tenant B user/token cannot read, list, update or delete tenant A resources (expect 404).
- Forged `tenantId` in body/query is ignored.
- Student token from academy A rejected on academy B host.
- Prisma extension throws without context.
- Composite FK rejects cross-tenant parent at DB level.
A route registry test fails CI if a new tenant-scoped route has no isolation test entry.
