import {
  Activity, Award, Banknote, BarChart3, BookOpen, Boxes, Brush, Building2, CalendarDays, ClipboardCheck, Component,
  CreditCard, Crown, FileText, FolderTree, Globe, GraduationCap, Handshake, HeartPulse, Inbox, LayoutDashboard, LifeBuoy,
  Link2, Mail, Megaphone, MessagesSquare, Package, Palette, Percent, Plug, Radio, Receipt, ScrollText, Settings, ShieldCheck,
  ShoppingCart, Sparkles, Tag, Ticket, UserCog, Users, Video, Wallet,
} from 'lucide-react';

/**
 * Navigation per panel (docs/UI_UX_NAVIGATION.md). `phase` = delivery phase; items are
 * rendered disabled until their route exists (`available`). When a phase ships its
 * pages, flip `available` and register the route — no dead links in between.
 */
const item = (label, to, icon, phase, extra = {}) => ({ label, to, icon, phase, available: false, ...extra });

export const NAV = {
  superAdmin: [
    { label: null, items: [item('Dashboard', '/super-admin', LayoutDashboard, 3, { end: true })] },
    { label: 'Tenants', items: [item('All tenants', '/super-admin/tenants', Building2, 3), item('Domains', '/super-admin/domains', Globe, 3)] },
    { label: 'Subscriptions', items: [item('Plans', '/super-admin/plans', Crown, 3), item('Subscriptions', '/super-admin/subscriptions', CreditCard, 3)] },
    {
      label: 'Finance',
      items: [item('Revenue', '/super-admin/finance', Wallet, 3), item('Transactions', '/super-admin/transactions', Receipt, 7), item('Settlements', '/super-admin/settlements', Banknote, 7)],
    },
    { label: 'Users', items: [item('Creators', '/super-admin/creators', Users, 3), item('Admins & roles', '/super-admin/admins', ShieldCheck, 3)] },
    { label: 'Support', items: [item('Tickets', '/super-admin/tickets', LifeBuoy, 3)] },
    { label: 'Content', items: [item('Categories', '/super-admin/categories', FolderTree, 3), item('Templates', '/super-admin/templates', Mail, 3)] },
    { label: 'Analytics', items: [item('Platform analytics', '/super-admin/analytics', BarChart3, 10)] },
    {
      label: 'System',
      items: [
        item('Settings', '/super-admin/settings', Settings, 3),
        item('Integrations', '/super-admin/integrations', Plug, 3),
        item('Audit logs', '/super-admin/audit-logs', ScrollText, 3),
        item('System status', '/status', HeartPulse, 1, { available: true }),
        item('Design system', '/design-system', Component, 1, { available: true }),
      ],
    },
  ],

  creator: [
    { label: null, items: [item('Dashboard', '/creator', LayoutDashboard, 4, { end: true }), item('My academy', '/creator/academy', Palette, 4)] },
    {
      label: 'Content',
      items: [
        item('Courses', '/creator/courses', BookOpen, 4),
        item('Products', '/creator/products', Package, 7),
        item('Question bank', '/creator/question-bank', ClipboardCheck, 5),
        item('Certificates', '/creator/certificates', Award, 5),
      ],
    },
    { label: 'Students', items: [item('Students', '/creator/students', GraduationCap, 5), item('Batches', '/creator/batches', Boxes, 9)] },
    {
      label: 'Sales',
      items: [item('Orders', '/creator/orders', ShoppingCart, 7), item('Transactions', '/creator/transactions', Receipt, 7), item('Coupons', '/creator/coupons', Tag, 7)],
    },
    { label: 'Live', items: [item('Live classes', '/creator/live', Radio, 9), item('Webinars', '/creator/webinars', CalendarDays, 9)] },
    { label: 'Website', items: [item('Website builder', '/creator/website', Brush, 8), item('Domains', '/creator/domains', Globe, 8)] },
    {
      label: 'Growth',
      items: [
        item('Marketing', '/creator/marketing', Megaphone, 10),
        item('Affiliates', '/creator/affiliates', Handshake, 10),
        item('Communities', '/creator/communities', MessagesSquare, 10),
        item('Analytics', '/creator/analytics', BarChart3, 10),
        item('AI studio', '/creator/ai', Sparkles, 10),
      ],
    },
    {
      label: 'Workspace',
      items: [
        item('Staff', '/creator/staff', UserCog, 4),
        item('Integrations', '/creator/integrations', Plug, 6),
        item('Settings', '/creator/settings', Settings, 4),
        item('Billing', '/creator/billing', CreditCard, 7),
        item('Support', '/creator/support', LifeBuoy, 3),
      ],
    },
  ],

  student: [
    {
      label: null,
      items: [
        item('Home', '/learn', LayoutDashboard, 5, { end: true }),
        item('My learning', '/learn/courses', BookOpen, 5),
        item('Live classes', '/learn/live', Video, 9),
        item('Certificates', '/learn/certificates', Award, 5),
        item('Communities', '/learn/communities', MessagesSquare, 10),
        item('Orders', '/learn/orders', Receipt, 7),
        item('Support', '/learn/support', LifeBuoy, 5),
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
        item('Dashboard', '/finance', LayoutDashboard, 3, { end: true }),
        item('Reconciliation', '/finance/reconciliation', Activity, 7),
        item('Refunds', '/finance/refunds', Receipt, 7),
        item('Payouts', '/finance/payouts', Banknote, 7),
        item('Invoices', '/finance/invoices', FileText, 7),
        item('Tax reports', '/finance/tax', Percent, 7),
      ],
    },
  ],

  support: [
    {
      label: null,
      items: [
        item('Inbox', '/support', Inbox, 3, { end: true }),
        item('All tickets', '/support/tickets', Ticket, 3),
        item('Reports', '/support/reports', BarChart3, 3),
      ],
    },
  ],
};
