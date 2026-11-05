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

## Implemented endpoints

| Phase | Method & path | Auth | Description |
|---|---|---|---|
| 1 | `GET /api/v1/health/live` | public | Liveness probe |
| 1 | `GET /api/v1/health` | public | Readiness: MySQL, Redis, queue (503 when any is down) |
| 1 | `GET /api/v1/system/info` | public | Platform name, non-secret branding, root domain, locales |
| 2 | `POST /auth/register/creator` · `/auth/register/student` | public | Sign-up (platform host / academy host) |
| 2 | `POST /auth/login` · `/auth/login/2fa` · `/auth/refresh` · `/auth/logout` · `/auth/logout-all` | public/auth | Session lifecycle (refresh needs `X-CSRF-Token`) |
| 2 | `GET /auth/me` · `POST /auth/switch-tenant` · `GET/DELETE /auth/sessions` | auth | Profile, workspace switch, devices |
| 2 | `POST /auth/email/verify` · `/email/verify-code` · `/email/resend` · `/otp/send` · `/otp/verify` | public/auth | Verification |
| 2 | `POST /auth/password/forgot` · `/password/reset` · `/password/change` | public/auth | Passwords |
| 2 | `POST /auth/2fa/setup` · `/2fa/enable` · `/2fa/disable` | auth | Two-factor |
| 2 | `GET /auth/providers` · `/auth/google/start` · `/auth/google/callback` · `POST /auth/google/handoff` | public | Google sign-in |
| 2 | `GET /creator/workspace` · `/creator/members` · `GET/POST /creator/domains` · `POST /creator/domains/:id/verify` · `PATCH /:id/primary` · `DELETE /:id` | workspace + RBAC | Creator workspace |
| 2 | `GET /public/site` | academy host | Academy identity |
| 3 | `GET /platform/dashboard` | platform.tenants.read | KPIs + series (`from`,`to`) |
| 3 | `GET /platform/tenants` · `GET /:id` · `POST /:id/activate` · `/:id/suspend` · `/:id/subscription` · `PUT /:id/limits` · `DELETE /:id` · `POST /:id/restore` | platform.tenants.* | Tenant administration |
| 3 | `GET /platform/features` · `GET/POST /platform/plans` · `GET/PUT /platform/plans/:id` · `GET /public/plans` | platform.plans.manage / public | Plans |
| 3 | `GET/PUT /platform/settings` | platform.settings.manage | Settings |
| 3 | `GET/POST /platform/admins` · `PUT /:id/roles` · `POST /:id/suspend` · `/:id/reactivate` | platform.admins.manage | Administrators |
| 3 | `GET /platform/audit-logs` | platform.audit.read | Audit trail |
| 3 | `GET /public/categories` · `POST/PUT/DELETE /platform/categories` · `GET/POST/PUT/DELETE /platform/announcements` · `GET /announcements/active` | platform.content.manage | Content |
| 3 | `GET/POST /creator/support/tickets` · `GET /:id` · `POST /:id/messages` · `GET /platform/support/tickets` · `GET/PATCH /:id` · `POST /:id/messages` · `GET /platform/support/agents` · `/report` | workspace / platform.support.manage | Support |
| 3 | `GET /creator/billing` | billing.manage | Plan, entitlements, usage |
| 4 | `POST /creator/files` · `POST /creator/files/:id/complete` · `PUT/GET /files/local/:token` | workspace / signed token | Direct uploads + verification |
| 4 | `GET/PUT /creator/academy` · `GET/PUT /creator/academy/business` | academy.manage | Profile, branding, business |
| 4 | `GET /creator/onboarding` · `PUT /creator/onboarding/step` · `POST /creator/onboarding/publish` | workspace | Onboarding |
| 4 | `GET /creator/dashboard` | workspace | Creator KPIs |
| 4 | `GET/POST /creator/courses` · `GET/PATCH/DELETE /:id` · `GET /:id/publish-check` · `POST /:id/publish|unpublish|archive|restore|duplicate` · `PUT /:id/instructors` | courses.read / courses.manage | Courses |
| 4 | `GET /creator/courses/:id/curriculum` · `PUT /:id/curriculum/order` · `POST/PATCH/DELETE /:id/sections[/:sid]` · `POST/PATCH/DELETE /:id/lessons[/:lid]` | courses.manage | Curriculum |
| 4 | `GET /creator/staff` · `POST/DELETE /creator/staff/invitations[/:id]` · `PATCH/DELETE /creator/staff/:memberId` · `GET /invitations/:token` · `POST /invitations/accept` · `POST /invitations/register` | staff.manage / public | Staff |
| 5 | `GET /public/courses` · `GET /public/courses/:slug` · `GET /public/courses/:slug/preview/:lessonId` · `GET /public/certificates/:number` | public | Catalogue, previews, verification |
| 5 | `GET /learn/enrollments` · `POST /learn/courses/:id/enroll` · `GET /learn/courses/:id/player` · `GET /learn/lessons/:id` · `PUT /:id/position` · `POST/DELETE /:id/complete` · `POST /:id/bookmark` · notes · comments | student | Learning |
| 5 | `GET /learn/lessons/:id/quiz` · `POST /:id/quiz/attempts` · `GET /learn/quiz-attempts/:id` · `PUT /:id/answers` · `POST /:id/submit` · `GET/POST /learn/lessons/:id/assignment[/submission]` · `POST /learn/files[/:id/complete]` · `GET /learn/certificates[/:id/pdf]` | student | Assessment & certificates |
| 5 | `GET /creator/students[/:id]` · `GET/POST /creator/courses/:id/enrollments` · `DELETE /creator/enrollments/:id` · discussions · quiz builder · `GET /creator/quiz-attempts/:id` · grading · assignments · certificate template/list/revoke/reinstate | workspace + RBAC | Creator learning tools |
| 6 | `POST /creator/files/:id/parts` · `POST /creator/files/:id/complete` (`{parts}` for multipart) · `GET /files/local/:token` (HTTP Range) | workspace / signed token | Multipart uploads (>100 MB on S3), ranged reads |
| 6 | `GET/POST /creator/videos` · `PATCH/DELETE /:id` · `GET /:id/preview` | courses.read / courses.manage | Video library (DELETE → 409 while used in lessons) |
| 6 | `POST /learn/lessons/:lessonId/video` · `PUT /learn/video-sessions/:id/heartbeat` · `DELETE /learn/video-sessions/:id` | student | Playback session (signed URL + `resumeAt`; 429 over 3 streams), heartbeat (position, `completed`; 403 when access ended), end |
| 7 | `GET/PUT/PATCH/DELETE /creator/payments/razorpay` · `POST /creator/payments/razorpay/verify` | integrations.manage | Academy's Razorpay account (secrets write-only; returns webhook URL) |
| 7 | `GET/POST /creator/coupons` · `PATCH/DELETE /creator/coupons/:id` | coupons.manage | Coupons (discount terms locked once used) |
| 7 | `GET /creator/orders` · `GET /creator/orders/summary` · `GET /creator/orders/:id` · `GET /creator/orders/:id/invoice` · `GET /creator/transactions` | orders.read | Orders, ledger-based revenue summary, invoice PDF, payment attempts |
| 7 | `POST /creator/orders/:id/refunds` | refunds.manage | Full/partial refund through Razorpay (`revokeAccess` for full refunds) |
| 7 | `POST /learn/checkout/quote` · `POST /learn/checkout` (`Idempotency-Key`) · `GET /learn/orders[/:id]` · `POST /learn/orders/:id/pay|confirm|abandon` · `GET /learn/orders/:id/invoice` | student | Checkout → Razorpay Checkout.js options → signature-verified confirmation |
| 7 | `POST /webhooks/razorpay/:accountId` | public (X-Razorpay-Signature) | Razorpay webhooks: `payment.*`, `order.paid`, `refund.*` |
| 7 | `GET /platform/finance/overview` · `GET /platform/finance/transactions` | platform.finance.read | Academy GMV, refunds, commission; payments across academies |
| 7 | `GET /creator/billing/plans` · `POST /creator/billing/quote|checkout` · `GET /creator/billing/invoices[/:id][/pdf]` · `POST /creator/billing/invoices/:id/pay|confirm` · `POST /creator/billing/cancellation` | billing.manage | Plan billing on the platform's Razorpay account |
| 7 | `GET /platform/billing/gateway` · `GET /platform/billing/subscriptions|invoices` · `GET /platform/billing/invoices/:id/pdf` · `POST /platform/billing/invoices/:id/record-payment|void` | platform.finance.read / manage | Subscriptions, invoices, bank-transfer recording |
| 7 | `POST /webhooks/razorpay/platform` | public (X-Razorpay-Signature) | Platform Razorpay webhook (plan billing) |
| 8 | `GET /creator/domains/subdomains/availability?name=` · `POST /creator/domains/subdomains` | domains.manage | Branded subdomains on the platform domain (live instantly, max 3) |
| 9 | `GET /creator/live/providers` · `GET/POST /creator/live/classes` · `GET/PATCH /creator/live/classes/:id` · `POST /classes/:id/cancel` · `POST /creator/live/sessions/:id/cancel|host|end` | live.manage + live_classes | Schedule and run live classes/webinars |
| 9 | `GET /creator/live/sessions/:id/attendance[.csv]|recording|admissions|polls|questions` · `POST /sessions/:id/admissions/:aid` · `POST /sessions/:id/polls[/:pid/close]` · `POST /sessions/:id/questions/:qid/answer` | live.manage | Attendance, recordings, waiting room, polls, Q&A |
| 9 | `GET/POST /creator/batches` · `GET/PATCH /creator/batches/:id` · `POST /:id/members` · `POST /:id/members/:mid/remove` · `POST /:id/archive` | students.read / students.manage | Batches |
| 9 | `GET /learn/live/upcoming|recordings` · `GET /learn/live/sessions/:id/recording|admission|polls|questions` · `POST /sessions/:id/join` · `POST /polls/:pid/vote` · `POST /questions[/:qid/upvote]` | student | Join, waiting room, polls, Q&A, recordings |
| 9 | `GET /public/webinars/:slug` · `POST /:slug/register` · `GET /public/live/tickets/:code` · `POST /tickets/:code/join` · ticket polls/Q&A | public (academy host) | Webinar registration and ticket joining |
| 9 | `POST /webhooks/livekit` | public (LiveKit JWT) | Attendance, room and recording events |
| 10 | `GET /notifications` · `POST /notifications/:id/read` · `POST /notifications/read-all` · `GET/PUT /notifications/preferences` · `POST/DELETE /notifications/push/subscriptions` | auth | In-app notifications, per-category channel preferences, web-push subscriptions |
| 10 | `GET /creator/leads` · `POST /creator/leads/import` · `GET/PATCH/DELETE /creator/leads/:id` | marketing.manage + `marketing` feature | Contacts with consent |
| 10 | `GET/POST /creator/campaigns` · `GET/PATCH /:id` · `POST /:id/test|schedule|cancel` | marketing.manage | Email campaigns (only consented contacts; List-Unsubscribe) |
| 10 | `GET/POST /creator/automations` · `GET/PATCH/DELETE /:id` | marketing.manage | Event-triggered email sequences |
| 10 | `POST /public/leads` · `GET/POST /public/unsubscribe` | public (academy host / signed token) | Lead form with consent; one-click unsubscribe |
| 10 | `GET/PUT /creator/affiliates/program` · `GET /creator/affiliates` · `GET /creator/affiliates/conversions` · `PATCH /:id` · `POST /:id/payouts` | affiliates.manage + `affiliates` feature | Affiliate program, approvals, commissions, payouts |
| 10 | `GET /learn/affiliate` · `POST /learn/affiliate/join` · `PUT /learn/affiliate/payout-details` · `POST /public/affiliates/click` | student / public | Student affiliate dashboard; referral click capture |
| 10 | `GET/POST /creator/communities` · `PATCH /:id` · `POST /:id/archive` · `GET/POST /:id/posts` · `GET /posts/:postId` · `POST /posts/:postId/comments|moderate` · `DELETE /posts/:postId` · `POST /comments/:id/hide` · `GET /reports` · `POST /reports/:id/resolve` | community.manage | Community spaces and moderation |
| 10 | `GET /learn/communities` · `GET/POST /:id/posts` · `GET /posts/:postId` · `POST /posts/:postId/comments|like` · `DELETE /posts/:postId` · `DELETE /comments/:id` · `POST /reports` | student (audience-checked) | Student communities |
| 10 | `GET/POST /creator/memberships` · `PATCH /:id` · `GET /:id/members` · `GET /public/memberships` · `GET /learn/memberships` | courses.manage / public / student | Membership plans (prepaid month/year; checkout with `membershipPlanId`) |
| 10 | `GET /creator/analytics/overview?from&to` · `GET /creator/analytics/courses` | analytics.read (+ `analytics.advanced` for courses) | Ledger-based sales, enrolments, daily series in academy time zone; per-course learning stats |
| 10 | `GET /creator/analytics/gst?from&to` · `GET /creator/analytics/exports/gst.csv|orders.csv` | orders.read | GST report: invoices + credit notes, IGST/CGST/SGST by place of supply; CSV (UTF-8 BOM, formula-safe) |
| 10 | `GET /creator/analytics/exports/students.csv|enrollments.csv?courseId` | students.read + `analytics.advanced` | Student and enrolment exports |
| 10 | `GET /creator/ai/usage` · `GET/PUT /creator/ai/settings` | courses.read / academy.manage | Monthly AI credits (plan `ai.credits`), study-assistant settings |
| 10 | `POST /creator/ai/course-outline` · `POST /creator/ai/courses/:id/apply-outline` · `POST /creator/ai/lesson-draft` · `POST /creator/ai/quiz-questions` | courses.manage | Claude: outline (added as draft lessons), lesson draft (rich text), multiple-choice questions |
| 10 | `GET/POST /learn/ai/tutor` | student with lesson access | Study assistant over the current lesson (daily per-student limit) |
| 11 | `/videos/*`, `/videos/webhooks/bunny`, `/backups/*`, `/platform/videos/usage` | see [video-management/api-reference.md](video-management/api-reference.md) | Bunny Stream uploads/processing/playback, Google Drive backups, video usage |
