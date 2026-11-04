# API Documentation

Status: **Phase 0 design**. Live docs will be served by Swagger at `/api/docs` (disabled or auth-protected in production) from Phase 1.

## Conventions
- Base: `/api/v1`. JSON only. CUID ids.
- Success: `{ "success": true, "data": …, "meta": { "page": 1, "pageSize": 20, "total": 134 } }`
- Error: `{ "success": false, "error": { "code": "VALIDATION_FAILED", "message": "…", "details": [{ "field": "email", "message": "…" }], "requestId": "…" } }`
- Pagination: `?page=&pageSize=` (max 100); cursor pagination (`?cursor=`) for feeds/logs.
- Filtering/sorting: `?status=PUBLISHED&q=react&sort=-createdAt`.
- Idempotency: `Idempotency-Key` header on order/checkout/refund/payout creation.
- Rate limits returned in `RateLimit-*` headers.
- Error codes: `UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, CONFLICT, RATE_LIMITED, PLAN_LIMIT_REACHED, FEATURE_NOT_IN_PLAN, INTEGRATION_NOT_CONFIGURED, TENANT_SUSPENDED, PAYMENT_PROVIDER_ERROR, INTERNAL`.

## Route groups (surface → prefix → guard)

| Surface | Prefix | Who |
|---|---|---|
| Auth | `/auth/*` | public + authenticated |
| Platform admin | `/platform/*` (super-admin, admin, finance, support sub-routes) | platform roles |
| Creator workspace | `/creator/*` | platform users with `TenantMember` in active tenant |
| Academy public | `/public/*` | anonymous, host-resolved tenant |
| Student | `/learn/*` | tenant-realm students |
| Affiliate | `/affiliate/*` | tenant-realm affiliates |
| Webhooks | `/webhooks/{provider}` | signature-verified |
| Live provider callbacks | `/integrations/{provider}/callback` | OAuth state-verified |

## Endpoint inventory (planned)

**Auth** — `POST register/creator`, `POST register/student`, `POST login`, `POST refresh`, `POST logout`, `POST logout-all`, `POST otp/send`, `POST otp/verify`, `POST email/verify`, `POST password/forgot`, `POST password/reset`, `GET me`, `GET sessions`, `DELETE sessions/:id`, `POST 2fa/setup|enable|disable|verify`, `GET google/start`, `GET google/callback`, `POST switch-tenant`.

**Platform** — `tenants` (CRUD, `:id/activate|suspend|limits|subscription|domains|usage|activity|revenue|students|courses|transactions`), `plans` (CRUD + features + prices), `subscriptions`, `settings` (grouped), `admins` (CRUD, roles, suspend), `roles`, `permissions`, `audit-logs`, `dashboard/metrics?range=`, `analytics/*`, `finance/{transactions,settlements,refunds,payouts,invoices,tax-report,reconciliation}`, `support/tickets` (+messages, assign, notes), `categories`, `pages`, `announcements`, `email-templates`, `notification-templates`, `integrations`, `exports`.

**Creator** — `onboarding` (state, step updates, publish), `dashboard`, `academy` (profile, theme, settings, business profile), `courses` (CRUD, duplicate, archive, publish/unpublish, schedule, instructors, analytics, students), `courses/:id/sections` & `lessons` (CRUD + `reorder`), `resources`, `uploads` (presign multipart, complete, abort), `videos` (CRUD, status, subtitles, watermark settings), `quizzes` & `question-banks`, `assignments` & `submissions` (grade), `certificates` (templates, issued, revoke), `products` (+prices, items), `orders`, `transactions`, `refunds` (approve/reject), `coupons`, `students` (list, detail, manual enroll, revoke, import CSV), `staff` (invite, roles), `live-classes` (+sessions, host-token, attendance, recordings), `webinars` (+registrations), `batches` (+members, announcements), `website/pages` (+versions, publish, rollback), `website/templates`, `domains` (add, verify, set primary), `blog`, `marketing/{campaigns,templates,segments,automations,leads}`, `affiliates` (approve, rules, payouts), `communities` (+posts moderation), `memberships`, `analytics/*`, `integrations/{payments,video,live,messaging,ai}`, `billing` (current plan, usage, invoices, change-plan, cancel), `support/tickets`, `ai/{course-outline,description,objectives,lesson,quiz,assignment,faq,sales-copy,email,ad-copy,titles}`.

**Public (academy)** — `site` (theme, nav, settings), `pages/:slug`, `courses`, `courses/:slug`, `products/:slug`, `instructors/:id`, `blog`, `blog/:slug`, `memberships`, `webinars/:id`, `contact`, `leads`, `newsletter`, `certificates/verify/:number`, `seo?path=`, `affiliate/click/:code`.

**Student** — `dashboard`, `enrollments`, `courses/:id/player` (curriculum + progress), `lessons/:id` (content with entitlement), `lessons/:id/progress`, `lessons/:id/complete`, `video/:assetId/playback` (issues short-lived playback token/OTP), `files/:id/access` (signed + watermarked), `bookmarks`, `notes`, `discussions`, `quizzes/:id/attempts` (start, answer, submit), `assignments/:id/submissions`, `certificates`, `live/upcoming`, `live/sessions/:id/join` (provider token), `cart`, `checkout`, `orders`, `refund-requests`, `memberships`, `communities/*`, `notifications`, `profile`, `ai/assistant`.

**Affiliate** — `register`, `dashboard`, `links`, `conversions`, `commissions`, `payouts` (request).

**Webhooks** — `razorpay`, `cashfree`, `stripe`, `paypal`, `mux`, `vdocipher`, `mediaconvert` (SNS), `livekit`, `zoom`.

This file is updated each phase with the implemented endpoints; Swagger is the source of truth for request/response schemas.
