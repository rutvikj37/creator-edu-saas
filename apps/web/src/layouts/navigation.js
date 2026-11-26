import {
  Activity, Bell, CircleUser, FileCheck2, Home, ListChecks, ShoppingBag, CalendarClock, MessageCircle, Award, Banknote, BarChart3, BookOpen, Boxes, Brush, Building2, ClipboardCheck, Component,
  CreditCard, Crown, FileText, FolderTree, Globe, GraduationCap, Handshake, HeartPulse, Inbox, LayoutDashboard, LifeBuoy,
  KeyRound, Layers, Library, Link2, Package, Mail, Megaphone, MessagesSquare, Palette, Percent, Plug, Radio, Receipt, ScrollText, Settings, ShieldCheck,
  ShoppingCart, Sparkles, Star, Tag, Ticket, UserCog, Users, Video, Wallet,
} from 'lucide-react';
import { FEATURE_FLAGS } from '../config/featureFlags.js';

/**
 * Navigation per panel (docs/UI_UX_NAVIGATION.md). `phase` = delivery phase; items are
 * rendered disabled until their route exists (`available`). When a phase ships its
 * pages, flip `available` and register the route — no dead links in between.
 */
const item = (label, to, icon, phase, extra = {}) => ({ label, to, icon, phase, available: false, ...extra });

export const NAV = {
  superAdmin: [
    { label: null, items: [item('Dashboard', '/super-admin', LayoutDashboard, 3, { end: true, available: true })] },
    { label: 'Tenants', items: [item('All tenants', '/super-admin/tenants', Building2, 3, { available: true, perm: 'platform.tenants.read' }), item('Domains', '/super-admin/domains', Globe, 8, { available: true, perm: 'platform.tenants.read' })] },
    { label: 'Subscriptions', items: [item('Plans', '/super-admin/plans', Crown, 3, { available: true, perm: 'platform.plans.manage' }), item('Plan billing', '/super-admin/subscriptions', CreditCard, 7, { available: true, perm: 'platform.finance.read' })] },
    {
      label: 'Finance',
      items: [item('Revenue', '/finance', Wallet, 3, { end: true, available: true, perm: 'platform.finance.read' }), item('Transactions', '/finance/transactions', Receipt, 7, { available: true, perm: 'platform.finance.read' }),
        item('Invoices', '/finance/invoices', FileText, 10, { available: true, perm: 'platform.finance.read' }), item('Tax reports', '/finance/tax', Percent, 10, { available: true, perm: 'platform.finance.read' })],
    },
    { label: 'Users', icon: Users, items: [item('Creators', '/super-admin/creators', Users, 3, { available: true, perm: 'platform.tenants.read' }), item('Admins & roles', '/super-admin/admins', ShieldCheck, 3, { available: true, perm: 'platform.admins.manage' })] },
    { label: 'Support', items: [item('Tickets', '/support', LifeBuoy, 3, { end: true, available: true, perm: 'platform.support.manage' }), item('Live chat', '/support/chat', MessageCircle, 10, { available: true, perm: 'platform.support.manage' })] },
    { label: 'Content', items: [item('Categories', '/super-admin/categories', FolderTree, 3, { available: true, perm: 'platform.content.manage' }), item('Announcements', '/super-admin/announcements', Megaphone, 3, { available: true, perm: 'platform.content.manage' }),
        item('Email templates', '/super-admin/templates', Mail, 10, { available: true, perm: 'platform.content.manage' })] },
    { label: 'Analytics', items: [item('Platform analytics', '/super-admin/analytics', BarChart3, 10, { available: true, perm: 'platform.tenants.read' })] },
    {
      label: 'System', icon: Settings,
      items: [
        item('Settings', '/super-admin/settings', Settings, 3, { available: true, perm: 'platform.settings.manage' }),
        item('Video usage', '/super-admin/video-usage', Video, 10, { available: true, perm: 'platform.system.read' }),
        item('Backups', '/super-admin/backups', Boxes, 10, { available: true, perm: 'platform.system.read' }),
        item('Integrations', '/super-admin/integrations', Plug, 6, { available: true, perm: 'platform.system.read' }),
        item('Audit logs', '/super-admin/audit-logs', ScrollText, 3, { available: true, perm: 'platform.audit.read' }),
        item('System status', '/super-admin/status', HeartPulse, 1, { available: true }),
        item('Design system', '/super-admin/design-system', Component, 1, { available: true }),
        item('Account security', '/super-admin/account/security', KeyRound, 2, { available: true }),
      ],
    },
  ],

  // Grouped like Graphy's creator dashboard: Home / Inbox / Community up top, then one rail
  // icon per section (Products, Learning, Users, Reports, Website, Marketing, Integrations, Settings).
  creator: [
    {
      label: null,
      items: [
        item('Home', '/creator', Home, 2, { end: true, available: true, tab: true }),
        item('Inbox', '/creator/chat', Inbox, 10, { available: true, perm: 'support.manage', tab: true }),
        item('Community', '/creator/communities', MessagesSquare, 10, { available: true, perm: 'community.manage', tab: true }),
      ],
    },
    {
      label: 'Products', icon: Package,
      items: [
        item('Courses', '/creator/courses', BookOpen, 4, { available: true, perm: 'courses.read' }),
        item('Packages', '/creator/bundles', Layers, 7, { available: true, perm: 'courses.read' }),
        item('Coaching', '/creator/coaching', CalendarClock, 10, { available: true, perm: 'courses.read' }),
        item('Memberships', '/creator/memberships', Crown, 10, { available: true, perm: 'courses.manage' }),
        item('Webinars & live', '/creator/live', Radio, 9, { available: true, perm: 'live.manage' }),
        item('Digital products', '/creator/products', ShoppingBag, 7, { available: true, perm: 'courses.read' }),
      ],
    },
    {
      label: 'Learning', icon: GraduationCap,
      items: [
        item('Asset library', '/creator/videos', Video, 6, { available: true, perm: 'courses.read' }),
        item('Course discussions', '/creator/discussions', MessagesSquare, 5, { available: true, perm: 'courses.read' }),
        item('Question bank', '/creator/question-bank', Library, 5, { available: true, perm: 'courses.read' }),
        item('Quiz reviews', '/creator/quiz-reviews', ClipboardCheck, 12, { available: true, perm: 'assessments.grade' }),
        item('Test reports', '/creator/test-reports', ListChecks, 12, { available: true, perm: 'assessments.grade' }),
        item('Assignments', '/creator/assignments', FileCheck2, 12, { available: true, perm: 'assessments.grade' }),
        item('Batches', '/creator/batches', Boxes, 9, { available: true, perm: 'students.read' }),
        item('Certificates', '/creator/certificates', Award, 5, { available: true, perm: 'certificates.manage' }),
        item('Ratings & reviews', '/creator/reviews', Star, 5, { available: true, perm: 'courses.read' }),
        // Hidden while FEATURE_FLAGS.AI_STUDIO is false — keep the entry for easy re-enable.
        ...(FEATURE_FLAGS.AI_STUDIO ? [item('AI studio', '/creator/ai', Sparkles, 10, { available: true, perm: 'courses.manage' })] : []),
      ],
    },
    {
      label: 'Users', icon: Users,
      items: [
        item('Learners', '/creator/students', GraduationCap, 5, { available: true, perm: 'students.read' }),
        item('Administrators', '/creator/staff', UserCog, 4, { available: true, perm: 'staff.manage', end: true }),
        item('Instructors', '/creator/staff?view=instructors', GraduationCap, 12, { available: true, perm: 'staff.manage' }),
        item('Affiliates', '/creator/affiliates', Handshake, 10, { available: true, perm: 'affiliates.manage' }),
        item('Help desk', '/creator/helpdesk', LifeBuoy, 10, { available: true, perm: 'support.manage' }),
      ],
    },
    {
      label: 'Reports', icon: BarChart3,
      items: [
        item('Overview', '/creator/reports', BarChart3, 10, { available: true, perm: 'analytics.read' }),
        item('Orders', '/creator/orders', ShoppingCart, 7, { available: true, perm: 'orders.read' }),
        item('Transactions', '/creator/transactions', Receipt, 7, { available: true, perm: 'orders.read' }),
        item('Settlements', '/creator/settlements', Wallet, 10, { available: true, perm: 'orders.read' }),
        item('Webinars', '/creator/reports/webinars', Radio, 12, { available: true, perm: 'live.manage' }),
        item('Traffic', '/creator/analytics', Activity, 10, { available: true, perm: 'analytics.read' }),
      ],
    },
    {
      label: 'Website', icon: Globe,
      items: [
        item('Website builder', '/creator/website', Brush, 8, { available: true, perm: 'website.manage' }),
        item('Branding', '/creator/academy', Palette, 4, { available: true, perm: 'academy.manage' }),
        item('Domains', '/creator/domains', Globe, 2, { available: true, perm: 'domains.manage' }),
      ],
    },
    {
      label: 'Marketing', icon: Megaphone,
      items: [
        item('Campaigns', '/creator/marketing', Megaphone, 10, { available: true, perm: 'marketing.manage' }),
        item('Promo codes', '/creator/coupons', Tag, 7, { available: true, perm: 'coupons.manage' }),
        item('Upsells & bumps', '/creator/upsells', Sparkles, 11, { available: true, perm: 'coupons.manage' }),
        item('Payment links', '/creator/payment-links', Link2, 11, { available: true, perm: 'coupons.manage' }),
        item('Cart recovery', '/creator/cart-recovery', Mail, 11, { available: true, perm: 'coupons.manage' }),
        item('Tracking pixels', '/creator/tracking', Activity, 11, { available: true, perm: 'marketing.manage' }),
      ],
    },
    {
      label: 'Integrations', icon: Plug,
      items: [
        item('Payment gateway', '/creator/payments', CreditCard, 7, { available: true, perm: 'integrations.manage' }),
        item('Live class apps', '/creator/integrations', Radio, 9, { available: true, perm: 'live.manage' }),
      ],
    },
    {
      label: 'Settings', icon: Settings,
      items: [
        item('Business details', '/creator/academy?tab=business', Building2, 4, { available: true, perm: 'academy.manage' }),
        item('Tax & invoicing', '/creator/settings/tax-invoicing', Receipt, 7, { available: true, perm: 'academy.manage' }),
        item('Security', '/creator/settings/security', ShieldCheck, 2, { available: true, perm: 'academy.manage' }),
        item('Communications', '/creator/settings/communications', Mail, 12, { available: true, perm: 'academy.manage' }),
        item('Custom fields', '/creator/settings/custom-fields', ListChecks, 12, { available: true, perm: 'academy.manage' }),
        item('User experience', '/creator/settings/user-experience', Palette, 12, { available: true, perm: 'academy.manage' }),
        item('Signup & login', '/creator/settings/signup-login', KeyRound, 12, { available: true, perm: 'academy.manage' }),
        item('Billing & plan', '/creator/billing', Wallet, 3, { available: true, perm: 'billing.manage' }),
      ],
    },
    {
      label: 'Account', icon: CircleUser, footer: true,
      items: [
        item('Account security', '/creator/account/security', KeyRound, 2, { available: true }),
        item('Notifications', '/creator/account/notifications', Bell, 2, { available: true }),
        item('Help center', '/creator/support', LifeBuoy, 3, { end: true, available: true, perm: 'settings.manage' }),
        item('Chat with support', '/creator/support-chat', MessageCircle, 10, { available: true, perm: 'settings.manage' }),
      ],
    },
  ],

  student: [
    {
      label: null,
      items: [
        item('My learning', '/learn', LayoutDashboard, 2, { end: true, available: true }),
        item('Browse courses', '/courses', BookOpen, 5, { available: true }),
        item('Live classes', '/learn/live', Video, 9, { available: true }),
        item('My batches', '/learn/batches', Boxes, 9, { available: true }),
        item('Certificates', '/learn/certificates', Award, 5, { available: true }),
      ],
    },
    {
      label: 'More',
      icon: Package,
      items: [
        item('Communities', '/learn/communities', MessagesSquare, 10, { available: true }),
        item('Memberships', '/memberships', Crown, 10, { available: true }),
        item('Downloads', '/learn/downloads', Package, 7, { available: true }),
        item('My coaching', '/learn/coaching', CalendarClock, 10, { available: true }),
        item('Orders', '/learn/orders', Receipt, 7, { available: true }),
        item('Chat with us', '/learn/chat', MessageCircle, 10, { available: true }),
        item('Earn by sharing', '/learn/affiliate', Handshake, 10, { available: true }),
        item('Support', '/learn/support', LifeBuoy, 5, { available: true }),
        item('Account security', '/learn/account/security', KeyRound, 2, { available: true }),
      ],
    },
  ],

  affiliate: [
    {
      label: null,
      items: [
        item('Dashboard', '/affiliate', LayoutDashboard, 10, { end: true }),
        item('Links & coupons', '/affiliate/links', Link2, 10),
        item('Conversions', '/affiliate/conversions', Activity, 10),
        item('Commissions', '/affiliate/commissions', Percent, 10),
        item('Payouts', '/affiliate/payouts', Banknote, 10),
      ],
    },
  ],

  finance: [
    {
      label: null,
      items: [
        item('Dashboard', '/finance', LayoutDashboard, 3, { end: true, available: true }),
        item('Transactions', '/finance/transactions', Receipt, 7, { available: true }),
        item('Plan billing', '/finance/billing', CreditCard, 7, { available: true }),
        item('Invoices', '/finance/invoices', FileText, 10, { available: true }),
        item('Tax reports', '/finance/tax', Percent, 10, { available: true }),
      ],
    },
  ],

  support: [
    {
      label: null,
      items: [
        item('Inbox', '/support', Inbox, 3, { end: true, available: true }),
        item('All tickets', '/support?view=all', Ticket, 3, { available: true }),
        item('Reports', '/support/reports', BarChart3, 3, { available: true }),
        item('Live chat', '/support/chat', MessageCircle, 10, { available: true }),
      ],
    },
  ],
};

/** Hides navigation items the user lacks permission for (the API enforces this regardless). */
export function filterNav(nav, can) {
  return nav
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || can(i.perm)) }))
    .filter((g) => g.items.length);
}
