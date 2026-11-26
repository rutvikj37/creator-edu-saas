# Graphy parity audit (creator dashboard)

Page-by-page comparison of Graphy's creator dashboard with ours, done 2026-11-26.
AI Brain, AI Agent and AI Avatar are out of scope by owner decision.

Legend: ✅ matches · 🟨 partly · ❌ missing · 🔒 Graphy page needs an email OTP to open, not audited yet

## Products

| Graphy page | What it has | Ours |
|---|---|---|
| Courses | list, filters | 🔒 (ours: list with status filter + search) |
| Packages | list | 🔒 (ours: Bundles with stats, status, date) |
| Coaching | Total bookings / revenue; Bookings (List · Calendar) and Programs tabs; filters Status, Booked on, Scheduled on, Program; coach settings + Google Calendar | ✅ |
| Memberships | Total members / revenue; filters Status, Created on | ✅ |
| Webinars | Upcoming / Past | ✅ (Live classes & webinars) |
| Digital products | Total sales / revenue; filters Status, Product type, Date created | ✅ |
| Telegram | Connect a channel/group, paid access via bot, auto member management | ❌ |
| Community clubs | Paid members / revenue; filters Status, Created on | ✅ |

## Learning

| Graphy page | What it has | Ours |
|---|---|---|
| Asset library | filters Course, Webinar, Asset type, Date modified/created, Tags, Video type, Processing status, Asset ID | ✅ (video, audio and live-recording types; documents stay on lessons) |
| Course discussions | | 🔒 (ours: Discussions with course filter) |
| Question bank | | 🔒 (ours: search, tag, type) |
| Quiz reviews | | ✅ |
| Test reports | Quizzes / Live tests tabs; Total quizzes, candidates, completions; table per quiz | ✅ (Quizzes; live tests not built) |
| Assignments | | ✅ |
| Live tests | timed test series | ❌ |
| Live classes | | 🔒 (ours: Live classes) |
| Ratings & reviews | | 🔒 (ours: course + status filters, reply, hide) |

## Users

| Graphy page | What it has | Ours |
|---|---|---|
| Learners | Add, Import (template builder), ~25 filters: Date joined, Last login, Courses, Membership (+status), Telegram, Coaching, Community club, Webinars, Verified email / mobile, Deactivated, Device id, Source, Refer code, UTM, Lead status, Segment, Blocked, Marketing consent, Deletion requested, Custom fields; "View learner count" | ✅ Course, Date joined, Last sign-in + More: membership (+status), coaching, club, webinar, verified email/mobile, deactivated, source, UTM, consent, segment (tag), custom field. Not: device id, refer code, lead status, blocked, deletion requested, Telegram |
| Administrators | Export, Add; filters Date joined, Last login, Deactivated; Role column | ✅ export, date joined, last login, role |
| Instructors | own list | ✅ Instructors tab (instructor role or teaches a course) |
| Affiliates | list with learner filters | ✅ |
| Leads | enquiries list, date filter, import | 🟨 marketing contacts |

## Reports

| Graphy page | What it has | Ours |
|---|---|---|
| Reports | Overview, Sales, Bandwidth & Usage, School Activity; 7/30/90 days, 1 year; downloads list | ✅ |
| Transactions | Total revenue / refunds, CSV, Add a transaction, refund; filters Products, Channel, Status, Type, Time period, Category, Affiliate, Promo code, Enrolment type | ✅ |
| Settlements | Total earnings, settled, to be settled; CSV; Payment date | ✅ |
| Webinars report | Registrations, participants, revenue (30 days); Upcoming / Past table: registrations, attendees, revenue | ✅ |
| Traffic | | ✅ (Analytics) |

## Website, mobile app

| Graphy page | What it has | Ours |
|---|---|---|
| Website → Pages | system pages: Home, landing templates per product type, store pages per product type, Contact us, Privacy policy, Refund policy, Terms of use | 🟨 builder + custom pages; no policy / store system pages |
| Website → Navigation | header/footer menu editor | 🟨 "In menu" flag per page |
| App builder | Android/iOS app, build history, Play Console keys | ❌ |

## Marketing (all 🔒 except where noted)

Campaigns, Messenger (WhatsApp), Wallet, Promo codes, Refer & earn, Affiliate settings — ours has Campaigns, Promo codes, Affiliates; ❌ Messenger, Wallet, Refer & earn.

## Integrations

Integrations, APIs, Webhooks, Logs — 🔒; ours ❌ API keys / outgoing webhooks / logs.

## Settings

| Graphy page | What it has | Ours |
|---|---|---|
| Domain | default + custom domain | ✅ |
| Payments | currency, tax, gateway, country pricing | ✅ (country pricing ❌) |
| Tax & invoicing | tax details, place of supply, LUT exports, invoice prefix/serial, note, GST input credit | ✅ |
| Security | device limit, 2FA for team, download devices, offline days, PDF + video watermark | ✅ (download/offline: app only) |
| Communications | sender name, reply / support / contact inboxes, custom email domain, purchase notification email; email template list with on/off; WhatsApp tab | ✅ sender name, reply inbox, purchase alerts, email on/off. Not: custom email domain, contact inbox (no contact form yet), WhatsApp |
| Custom fields | extra signup fields: title, type, required, editable, ask before first course access | ✅ |
| User experience | verify new accounts, archive/bookmark courses, learner dashboard style, review notification email, cookie banner, default logged-out form, login/logout messages, reset devices | ✅ verify email, review emails, cookie notice, default form. Not: archive, dashboard style, login/logout messages, reset devices |
| Signup & login | Google sign-in, double opt-in for marketing, secure password policy | ✅ Google switch, secure password policy. Not: double opt-in |

## Account

Billing & usage (plan, invoices, wallet, usage breakdown) — 🟨 plan + invoices, no wallet. Notifications 🔒. Referrals ❌.

## Status (2026-11-26)

Done: Learning reports, Users filters/team, Settings (Communications, Custom fields, User experience, Signup & login), Asset library filters. Website group (policy/store pages, menu editor) is on hold by owner decision.

## Build order

1. Learning reports: Test reports, Quiz reviews, Assignments (cross-course), Webinars report.
2. Users: more learner filters; administrator export + date filters.
3. Settings: Communications, Custom fields, User experience, Signup & login.
4. Website system pages (policies, contact) and navigation editor.
5. Larger modules: Telegram, Live tests, Wallet & usage, Refer & earn, WhatsApp messenger, API keys / webhooks / logs, App builder.
