import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router';
import { Spinner } from '../components/ui/index.js';
import { RouteError } from './RouteError.jsx';
import { GuestOnly, RequireAuth, SurfaceOnly } from './guards.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';
import { AffiliateLayout, CreatorLayout, FinanceLayout, StudentLayout, SuperAdminLayout, SupportLayout } from '../layouts/PanelLayouts.jsx';
import { getSurface } from '../utils/host.js';

// Route-level code splitting: each screen loads only when visited.
const lazyNamed = (loader, name) => lazy(() => loader().then((m) => ({ default: m[name] })));
const PlatformLandingPage = lazyNamed(() => import('../pages/public/PlatformLandingPage.jsx'), 'PlatformLandingPage');
const AcademyLandingPage = lazyNamed(() => import('../pages/public/AcademyLandingPage.jsx'), 'AcademyLandingPage');
const LoginPage = lazyNamed(() => import('../pages/auth/LoginPage.jsx'), 'LoginPage');
const SignupPage = lazyNamed(() => import('../pages/auth/SignupPage.jsx'), 'SignupPage');
const StudentRegisterPage = lazyNamed(() => import('../pages/auth/StudentRegisterPage.jsx'), 'StudentRegisterPage');
const ForgotPasswordPage = lazyNamed(() => import('../pages/auth/ForgotPasswordPage.jsx'), 'ForgotPasswordPage');
const ResetPasswordPage = lazyNamed(() => import('../pages/auth/ResetPasswordPage.jsx'), 'ResetPasswordPage');
const VerifyEmailPage = lazyNamed(() => import('../pages/auth/VerifyEmailPage.jsx'), 'VerifyEmailPage');
const AuthCallbackPage = lazyNamed(() => import('../pages/auth/AuthCallbackPage.jsx'), 'AuthCallbackPage');
const MfaSetupPage = lazyNamed(() => import('../pages/auth/MfaSetupPage.jsx'), 'MfaSetupPage');
const SecurityPage = lazyNamed(() => import('../pages/account/SecurityPage.jsx'), 'SecurityPage');
const WorkspaceHomePage = lazyNamed(() => import('../pages/creator/WorkspaceHomePage.jsx'), 'WorkspaceHomePage');
const DomainsPage = lazyNamed(() => import('../pages/creator/DomainsPage.jsx'), 'DomainsPage');
const StudentHomePage = lazyNamed(() => import('../pages/student/StudentHomePage.jsx'), 'StudentHomePage');
const SuperAdminHomePage = lazyNamed(() => import('../pages/system/SuperAdminHomePage.jsx'), 'SuperAdminHomePage');
const SystemStatusPage = lazyNamed(() => import('../pages/system/SystemStatusPage.jsx'), 'SystemStatusPage');
const DesignSystemPage = lazyNamed(() => import('../pages/system/design-system/DesignSystemPage.jsx'), 'DesignSystemPage');
const LayoutPreviewPage = lazyNamed(() => import('../pages/preview/LayoutPreviewPage.jsx'), 'LayoutPreviewPage');
const AdminDashboardPage = lazyNamed(() => import('../pages/admin/AdminDashboardPage.jsx'), 'AdminDashboardPage');
const TenantsPage = lazyNamed(() => import('../pages/admin/TenantsPage.jsx'), 'TenantsPage');
const TenantDetailPage = lazyNamed(() => import('../pages/admin/TenantDetailPage.jsx'), 'TenantDetailPage');
const PlansPage = lazyNamed(() => import('../pages/admin/PlansPage.jsx'), 'PlansPage');
const PlanEditorPage = lazyNamed(() => import('../pages/admin/PlanEditorPage.jsx'), 'PlanEditorPage');
const SettingsPage = lazyNamed(() => import('../pages/admin/SettingsPage.jsx'), 'SettingsPage');
const AdminsPage = lazyNamed(() => import('../pages/admin/AdminsPage.jsx'), 'AdminsPage');
const AuditLogsPage = lazyNamed(() => import('../pages/admin/AuditLogsPage.jsx'), 'AuditLogsPage');
const CategoriesPage = lazyNamed(() => import('../pages/admin/ContentPages.jsx'), 'CategoriesPage');
const AnnouncementsPage = lazyNamed(() => import('../pages/admin/ContentPages.jsx'), 'AnnouncementsPage');
const SupportInboxPage = lazyNamed(() => import('../pages/support/SupportInboxPage.jsx'), 'SupportInboxPage');
const StaffTicketPage = lazyNamed(() => import('../pages/support/StaffTicketPage.jsx'), 'StaffTicketPage');
const SupportReportPage = lazyNamed(() => import('../pages/support/SupportReportPage.jsx'), 'SupportReportPage');
const FinanceDashboardPage = lazyNamed(() => import('../pages/finance/FinanceDashboardPage.jsx'), 'FinanceDashboardPage');
const BillingPage = lazyNamed(() => import('../pages/creator/BillingPage.jsx'), 'BillingPage');
const CreatorSupportPage = lazyNamed(() => import('../pages/creator/CreatorSupportPage.jsx'), 'CreatorSupportPage');
const CreatorTicketPage = lazyNamed(() => import('../pages/creator/CreatorSupportPage.jsx'), 'CreatorTicketPage');

const page = (Component, props) => (
  <Suspense fallback={<div className="grid min-h-[40vh] place-items-center"><Spinner /></div>}>
    <Component {...props} />
  </Suspense>
);

const PREVIEW_LAYOUTS = {
  'super-admin': SuperAdminLayout,
  finance: FinanceLayout,
  support: SupportLayout,
  creator: (p) => <CreatorLayout preview {...p} />,
  student: (p) => <StudentLayout preview {...p} />,
  affiliate: AffiliateLayout,
};

const sharedAuthRoutes = [
  { path: '/forgot-password', element: page(ForgotPasswordPage) },
  { path: '/reset-password', element: page(ResetPasswordPage) },
  { path: '/verify-email', element: page(VerifyEmailPage) },
  { path: '/auth/callback', element: page(AuthCallbackPage) },
];

export function buildRoutes(surface = getSurface()) {
  const platform = [
    { path: '/', element: page(PlatformLandingPage) },
    { element: <GuestOnly />, children: [{ path: '/login', element: page(LoginPage) }, { path: '/signup', element: page(SignupPage) }] },
    ...sharedAuthRoutes,
    { element: <RequireAuth allowMfaSetup />, children: [{ path: '/setup-2fa', element: page(MfaSetupPage) }] },
    {
      element: <RequireAuth admin />,
      children: [
        {
          element: <SuperAdminLayout />,
          children: [
            { path: '/super-admin', element: page(AdminDashboardPage) },
            { path: '/super-admin/welcome', element: page(SuperAdminHomePage) },
            { path: '/super-admin/tenants', element: page(TenantsPage) },
            { path: '/super-admin/tenants/:id', element: page(TenantDetailPage) },
            { path: '/super-admin/plans', element: page(PlansPage) },
            { path: '/super-admin/plans/new', element: page(PlanEditorPage) },
            { path: '/super-admin/plans/:id', element: page(PlanEditorPage) },
            { path: '/super-admin/settings', element: page(SettingsPage) },
            { path: '/super-admin/admins', element: page(AdminsPage) },
            { path: '/super-admin/audit-logs', element: page(AuditLogsPage) },
            { path: '/super-admin/categories', element: page(CategoriesPage) },
            { path: '/super-admin/announcements', element: page(AnnouncementsPage) },
            { path: '/super-admin/status', element: page(SystemStatusPage) },
            { path: '/super-admin/design-system', element: page(DesignSystemPage) },
            { path: '/super-admin/account/security', element: page(SecurityPage, { breadcrumbs: [{ label: 'System' }] }) },
            ...Object.entries(PREVIEW_LAYOUTS).map(([key]) => ({ path: `/super-admin/preview/${key}`, element: <Navigate to={`/preview/${key}`} replace /> })),
          ],
        },
        ...Object.entries(PREVIEW_LAYOUTS).map(([key, Layout]) => ({ path: `/preview/${key}`, element: <Layout />, children: [{ index: true, element: page(LayoutPreviewPage) }] })),
        {
          element: <FinanceLayout />,
          children: [{ path: '/finance', element: page(FinanceDashboardPage) }],
        },
        {
          element: <SupportLayout />,
          children: [
            { path: '/support', element: page(SupportInboxPage) },
            { path: '/support/tickets/:id', element: page(StaffTicketPage) },
            { path: '/support/reports', element: page(SupportReportPage) },
          ],
        },
      ],
    },
    {
      element: <RequireAuth workspace />,
      children: [
        {
          element: <CreatorLayout />,
          children: [
            { path: '/creator', element: page(WorkspaceHomePage) },
            { path: '/creator/domains', element: page(DomainsPage) },
            { path: '/creator/billing', element: page(BillingPage) },
            { path: '/creator/support', element: page(CreatorSupportPage) },
            { path: '/creator/support/:id', element: page(CreatorTicketPage) },
            { path: '/creator/account/security', element: page(SecurityPage, { breadcrumbs: [{ label: 'Workspace' }] }) },
          ],
        },
      ],
    },
    { element: <RequireAuth />, children: [{ path: '/account/security', element: <NoWorkspacePage /> }] },
  ];

  const academy = [
    { path: '/', element: page(AcademyLandingPage) },
    { element: <GuestOnly />, children: [{ path: '/login', element: page(LoginPage) }, { path: '/register', element: page(StudentRegisterPage) }] },
    ...sharedAuthRoutes,
    {
      element: <RequireAuth />,
      children: [
        {
          element: <StudentLayout />,
          children: [
            { path: '/learn', element: page(StudentHomePage) },
            { path: '/learn/account/security', element: page(SecurityPage, { breadcrumbs: [{ label: 'Account' }] }) },
          ],
        },
      ],
    },
  ];

  return [
    { errorElement: <RouteError />, element: <SurfaceOnly surface={surface} />, children: surface === 'academy' ? academy : platform },
    { path: '*', element: <NotFoundPage /> },
  ];
}

/** Platform user with neither admin role nor workspace (e.g. removed from all academies). */
function NoWorkspacePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {page(SecurityPage)}
    </div>
  );
}
