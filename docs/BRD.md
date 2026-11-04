# Business Requirements Document — Creator Education SaaS Platform

## Vision
An all-in-one platform where educators, coaches, institutes and creators launch a branded online academy: website, courses, live classes, payments, marketing, affiliates, communities and certificates — operated centrally by the platform owner.

## Stakeholders & personas
| Persona | Goal |
|---|---|
| Platform owner (Super Admin) | Grow tenants and recurring revenue; control plans, payments, compliance |
| Platform / Finance / Support admins | Operate content, money and support with least privilege |
| Creator (tenant owner) | Launch and monetise an academy quickly without technical skills |
| Creator staff / instructors | Build content, teach live, grade, support students |
| Student | Discover, buy and complete courses on any device; earn certificates |
| Affiliate | Promote an academy and earn tracked commissions |

## Revenue model
1. SaaS subscriptions (monthly/annual plans, trials) — fully configurable by Super Admin.
2. Transaction commission per plan (`commission.percent`).
3. Add-ons: AI credits, extra storage/bandwidth, extra custom domains.

## Business rules (summary)
- Each tenant's data, branding, students and money are isolated.
- Plan entitlements gate features and limits; no hardcoded plan logic.
- Payments are recognised only after provider-verified webhook; refunds reverse commissions and ledger.
- Expired subscription → grace period (configurable, default 7 days) → read-only creator panel and paused academy sales; student access to already-purchased content continues for a configurable period.
- India-first (INR, GST, UPI, Razorpay/Cashfree) with international support (Stripe, PayPal, multi-currency).
- Languages at launch: English, Hindi, Gujarati.

## Success metrics
Time-to-first-published-course < 30 min; checkout conversion; MRR / churn; student completion rate; support first-response time; 99.9 % monthly availability.

## Out of scope
Native mobile apps (web only, fully responsive); a second backend language; non-MySQL primary datastore.
