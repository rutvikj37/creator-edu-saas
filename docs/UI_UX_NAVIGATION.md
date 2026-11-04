# UI/UX: Design System & Panel Navigation

Status: **Phase 0 design**. Original design (references used only for functional inspiration).

## 1. Design system ("Lumen")

| Token | Value |
|---|---|
| Font | Inter (UI), optional tenant heading font from a curated Google Fonts list; Noto Sans Devanagari / Noto Sans Gujarati fallbacks for hi/gu |
| Type scale | 12 / 13 / 14 (body) / 16 / 18 / 20 / 24 / 30 / 36 px; line-height 1.5 body, 1.25 headings |
| Spacing | 4-pt scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 |
| Radius | sm 6, md 8 (default controls), lg 12 (cards), xl 16 (modals), full (pills) |
| Shadows | xs (inputs), sm (cards), md (dropdowns), lg (modals) — soft, low-opacity |
| Neutral palette | slate-like: 25 … 950 (backgrounds 25/50, borders 200, text 600/900) |
| Brand (platform) | Indigo 600 `#4F46E5` primary, hover 700; accent teal 500 |
| Semantic | success green-600, warning amber-500, danger red-600, info sky-600 |
| Tenant theming | Academy surfaces read `--color-primary-*` CSS variables generated from the creator's brand color (contrast-checked to WCAG AA, auto-adjusted if it fails) |
| Dark mode | Tokens defined for light + dark; dashboards support both, preference remembered |

Primitives (`components/ui`): Button (primary/secondary/ghost/danger, sm/md/lg, loading), IconButton, Input, Textarea, Select, Combobox, MultiSelect, Checkbox, Radio, Switch, DatePicker/DateRange, FileDropzone, RichTextEditor (TipTap), Card, StatCard, DataTable (sort, filter chips, column visibility, row selection, bulk actions, server pagination), Tabs, Badge/StatusBadge, Avatar, Tooltip, DropdownMenu, Modal, ConfirmDialog, Drawer/Sheet, Toast (sonner-style), Breadcrumbs, Pagination, Skeleton, EmptyState (icon + title + description + CTA), ErrorState, Stepper, ProgressBar, CommandPalette (⌘K search).

UX rules: zod schemas shared between form and API error mapping; optimistic updates for toggles/reorders; confirmation for destructive actions (typed confirmation for tenant delete); every list has search + filters + sort + pagination + empty state; skeletons not spinners for page loads; toasts for success/failure; focus rings visible; all interactive components keyboard-operable; WCAG AA contrast.

## 2. Layout shell (all dashboards)
```
┌──────────────┬──────────────────────────────────────────────────────────────┐
│ Logo / tenant│ ☰  Breadcrumbs            [⌘K Search]   🔔  ?  (Avatar ▾)     │
│ switcher     ├──────────────────────────────────────────────────────────────┤
│ Sidebar nav  │ Page title                         [Secondary] [Primary CTA] │
│ (groups,     │ Tabs / filters                                               │
│ collapsible, │ ┌──────────────────────────────────────────────────────────┐ │
│ remembers    │ │ Content                                                   │ │
│ state)       │ └──────────────────────────────────────────────────────────┘ │
│ Plan usage ▸ │                                                              │
└──────────────┴──────────────────────────────────────────────────────────────┘
```
Mobile: sidebar becomes an off-canvas drawer; tables collapse to stacked cards; sticky bottom actions on forms.

## 3. Panel navigation

### Super Admin (`app.<root>/super-admin`)
- **Overview**: Dashboard (KPIs + 8 charts + date-range filter)
- **Tenants**: All tenants · Create tenant · Domains · Usage & limits
- **Subscriptions**: Plans · Features catalog · Active subscriptions · Expiring · Failed renewals
- **Finance**: Revenue · Transactions · Settlements · Refunds · Payouts · Invoices · Tax reports
- **Users**: Creators · Students (platform-wide search) · Admins · Roles & permissions
- **Support**: Tickets · Categories · SLA reports
- **Content**: Categories · Public pages · Announcements · Email templates · Notification templates
- **Analytics**: Platform · Growth · Churn · Feature usage · Exports
- **System**: Platform settings (General, Branding, Registration, Email, SMS, WhatsApp, Payments, Tax, Legal, Maintenance) · Integrations · Audit logs · Queues & health

### Platform Admin (`/admin`) — subset by permission
Dashboard · Tenants (view/edit, no delete) · Categories · Public pages · Announcements · Email & notification templates · Integrations · System configuration · Audit logs (own actions)

### Finance Admin (`/finance`)
Dashboard · Platform revenue · Subscription revenue · Transaction fees · Creator sales · Reconciliation · Refunds · Settlements · Payout records · Invoices · Tax reports · Exports

### Support Admin (`/support`)
Inbox (My tickets / Unassigned / All) · Ticket detail (thread, internal notes, attachments, assignment, priority, status) · Categories · Canned responses · Resolution reports · Tenant lookup (read-only)

### Creator / Instructor (`app.<root>/c/:tenantSlug`) and Creator Staff (same layout, items filtered by role permissions)
- Dashboard
- My Academy: Profile · Branding · Business & tax · Domains
- **Content**: Courses · Products · Question bank · Certificates
- **Students**: All students · Enrollments · Batches · Assignments to grade · Reviews · Discussions
- **Sales**: Orders · Transactions · Refund requests · Coupons · Invoices
- **Live**: Live classes · Webinars · Recordings · Attendance
- **Website**: Pages (builder) · Navigation · Blog · Templates · SEO
- **Growth**: Marketing (Campaigns, Automations, Templates, Segments, Leads) · Affiliates · Communities · Memberships
- Analytics: Overview · Revenue · Courses · Engagement · Live · Marketing · Affiliates
- **Workspace**: Staff & roles · Integrations (payments, video, live, messaging, AI) · Settings · Billing & subscription · Support
- Onboarding checklist pinned until complete (10-step wizard, resumable)

Course editor (full-screen sub-layout): Details · Curriculum (drag-and-drop sections/lessons/sub-lessons) · Pricing · Access & drip · Certificate · SEO · Students · Analytics · Preview · Publish.

Website builder (full-screen): left = section library & page list; center = canvas with Desktop/Tablet/Mobile toggle; right = block properties; top = Undo/Redo, Draft/Published, Version history, Preview, Publish.

### Student Portal (academy host `/learn`)
Home (continue learning) · My Learning (In progress / Completed / All) · Live classes (upcoming, recordings, attendance) · Certificates · Communities · Memberships · Orders & invoices · Notifications · Profile & security · Support
Player (full-screen): left curriculum w/ completion ticks · center content (video/PDF/text/quiz/assignment) + prev/next + mark complete · right tabs Notes / Discussion / Resources / AI assistant.

### Affiliate Panel (academy host `/affiliate`)
Dashboard · Links & coupons · Clicks & conversions · Commissions · Payouts · Profile & payout details

### Public Academy Website (academy host)
Header (logo, nav, login/cart) → Home · Courses · Course detail · About · Instructor · Blog · Blog detail · Membership · Webinars · Contact · FAQ · Login · Register · Cart/Checkout · Privacy · Terms · Refund · Certificate verify; footer from footer builder.

### Main marketing site (`www.<root>`)
Home · Features · Pricing (live from plans table) · Sign up / Log in · Legal pages.
