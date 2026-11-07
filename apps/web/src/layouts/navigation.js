import {
  Activity, MessageCircle, Award, Banknote, BarChart3, BookOpen, Boxes, Brush, Building2, ClipboardCheck, Component,
  CreditCard, Crown, FileText, FolderTree, Globe, GraduationCap, Handshake, HeartPulse, Inbox, LayoutDashboard, LifeBuoy,
  KeyRound, Layers, Library, Link2, Package, Mail, Megaphone, MessagesSquare, Palette, Percent, Plug, Radio, Receipt, ScrollText, Settings, ShieldCheck,
  ShoppingCart, Sparkles, Star, Tag, Ticket, UserCog, Users, Video, Wallet,
} from 'lucide-react';

/**
 * Navigation per panel (docs/UI_UX_NAVIGATION.md). `phase` = delivery phase; items are
 * rendered disabled until their route exists (`available`). When a phase ships its
 * pages, flip `available` and register the route — no dead links in between.
 */
const item = (label, to, icon, phase, extra = {}) => ({ label, to, icon, phase, available: false, ...extra });

export const NAV = {
  superAdmin: [
    { label: null, items: [item('Dashboard', '/super-admin', LayoutDashboard, 3, { end: true, available: true })] },
    { label: 'Tenants', items: [item('All tenants', '/super-admin/tenants', Building2, 3, { available: true, perm: 'platform.tenants.read' }), item('Domains', '/super-admin/domains', Globe, 8)] },
    { label: 'Subscriptions', items: [item('Plans', '/super-admin/plans', Crown, 3, { available: true, perm: 'platform.plans.manage' }), item('Plan billing', '/super-admin/subscriptions', CreditCard, 7, { available: true, perm: 'platform.finance.read' })] },
    {
      label: 'Finance',
      items: [item('Revenue', '/finance', Wallet, 3, { available: true, perm: 'platform.finance.read' }), item('Transactions', '/finance/transactions', Receipt, 7, { available: true, perm: 'platform.finance.read' })],
    },
    { label: 'Users', items: [item('Creators', '/super-admin/tenants', Users, 3, { available: true, perm: 'platform.tenants.read' }), item('Admins & roles', '/super-admin/admins', ShieldCheck, 3, { available: true, perm: 'platform.admins.manage' })] },
    { label: 'Support', items: [item('Tickets', '/support', LifeBuoy, 3, { available: true, perm: 'platform.support.manage' }), item('Live chat', '/support/chat', MessageCircle, 10, { available: true, perm: 'platform.support.manage' })] },
    { label: 'Content', items: [item('Categories', '/super-admin/categories', FolderTree, 3, { available: true, perm: 'platform.content.manage' }), item('Announcements', '/super-admin/announcements', Megaphone, 3, { available: true, perm: 'platform.content.manage' }),
        item('Templates', '/super-admin/templates', Mail, 10)] },
    { label: 'Analytics', items: [item('Platform analytics', '/super-admin/analytics', BarChart3, 10)] },
    {
      label: 'System',
      items: [
        item('Settings', '/super-admin/settings', Settings, 3, { available: true, perm: 'platform.settings.manage' }),
        item('Video usage', '/super-admin/video-usage', Video, 10, { available: true, perm: 'platform.system.read' }),
        item('Backups', '/super-admin/backups', Boxes, 10, { available: true, perm: 'platform.system.read' }),
        item('Integrations', '/super-admin/integrations', Plug, 6),
        item('Audit logs', '/super-admin/audit-logs', ScrollText, 3, { available: true, perm: 'platform.audit.read' }),
        item('System status', '/super-admin/status', HeartPulse, 1, { available: true }),
        item('Design system', '/super-admin/design-system', Component, 1, { available: true }),
        item('Account security', '/super-admin/account/security', KeyRound, 2, { available: true }),
      ],
    },
  ],

  creator: [
    { label: null, items: [item('Dashboard', '/creator', LayoutDashboard, 2, { end: true, available: true }), item('My academy', '/creator/academy', Palette, 4, { available: true, perm: 'academy.manage' })] },
    {
      label: 'Content', icon: BookOpen,
      items: [
        item('Courses', '/creator/courses', BookOpen, 4, { available: true, perm: 'courses.read' }),
        item('Asset library', '/creator/videos', Video, 6, { available: true, perm: 'courses.read' }),
        item('Discussions', '/creator/discussions', MessagesSquare, 5, { available: true, perm: 'courses.read' }),
        item('Certificates', '/creator/certificates', Award, 5, { available: true, perm: 'certificates.manage' }),
        item('Bundles', '/creator/bundles', Layers, 7, { available: true, perm: 'courses.read' }),
        item('Digital products', '/creator/products', Package, 7, { available: true, perm: 'courses.read' }),
        item('Ratings & reviews', '/creator/reviews', Star, 5, { available: true, perm: 'courses.read' }),
        item('Question bank', '/creator/question-bank', Library, 5, { available: true, perm: 'courses.read' }),
        item('Memberships', '/creator/memberships', Crown, 10, { available: true, perm: 'courses.manage' }),
      ],
    },
    { label: 'Students', icon: GraduationCap, items: [item('Students', '/creator/students', GraduationCap, 5, { available: true, perm: 'students.read' }), item('Batches', '/creator/batches', Boxes, 9, { available: true, perm: 'students.read' }), item('Chat inbox', '/creator/chat', MessageCircle, 10, { available: true, perm: 'support.manage' })] },
    {
      label: 'Sales', icon: ShoppingCart,
      items: [
        item('Orders', '/creator/orders', ShoppingCart, 7, { available: true, perm: 'orders.read' }),
        item('Transactions', '/creator/transactions', Receipt, 7, { available: true, perm: 'orders.read' }),
        item('Promo codes', '/creator/coupons', Tag, 7, { available: true, perm: 'coupons.manage' }),
      ],
    },
    { label: 'Live', icon: Radio, items: [item('Live classes & webinars', '/creator/live', Radio, 9, { available: true, perm: 'live.manage' }), item('Integrations', '/creator/integrations', Plug, 9, { available: true, perm: 'live.manage' })] },
    { label: 'Website', icon: Globe, items: [item('Website', '/creator/website', Brush, 8, { available: true, perm: 'website.manage' }), item('Domains', '/creator/domains', Globe, 2, { available: true, perm: 'domains.manage' })] },
    {
      label: 'Growth', icon: Megaphone,
      items: [
        item('Marketing', '/creator/marketing', Megaphone, 10, { available: true, perm: 'marketing.manage' }),
        item('Affiliates', '/creator/affiliates', Handshake, 10, { available: true, perm: 'affiliates.manage' }),
        item('Communities', '/creator/communities', MessagesSquare, 10, { available: true, perm: 'community.manage' }),
        item('Analytics', '/creator/analytics', BarChart3, 10, { available: true, perm: 'analytics.read' }),
        item('AI studio', '/creator/ai', Sparkles, 10, { available: true, perm: 'courses.manage' }),
      ],
    },
    {
      label: 'Workspace', icon: Settings,
      items: [
        item('Staff', '/creator/staff', UserCog, 4, { available: true, perm: 'staff.manage' }),
        item('Payments', '/creator/payments', Plug, 7, { available: true, perm: 'integrations.manage' }),
        item('Settings', '/creator/academy?tab=business', Settings, 4, { available: true, perm: 'academy.manage' }),
        item('Billing', '/creator/billing', CreditCard, 3, { available: true, perm: 'billing.manage' }),
        item('Support', '/creator/support', LifeBuoy, 3, { available: true }),
        item('Chat with support', '/creator/support-chat', MessageCircle, 10, { available: true }),
        item('Account security', '/creator/account/security', KeyRound, 2, { available: true }),
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
        item('Certificates', '/learn/certificates', Award, 5, { available: true }),
        item('Communities', '/learn/communities', MessagesSquare, 10, { available: true }),
        item('Memberships', '/memberships', Crown, 10, { available: true }),
        item('Downloads', '/learn/downloads', Package, 7, { available: true }),
        item('Orders', '/learn/orders', Receipt, 7, { available: true }),
        item('Chat with us', '/learn/chat', MessageCircle, 10, { available: true }),
        item('Earn by sharing', '/learn/affiliate', Handshake, 10, { available: true }),
        item('Support', '/learn/support', LifeBuoy, 5),
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
        item('Invoices', '/finance/invoices', FileText, 10),
        item('Tax reports', '/finance/tax', Percent, 10),
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
