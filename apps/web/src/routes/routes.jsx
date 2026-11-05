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
const AcademySitePage = lazyNamed(() => import('../pages/public/AcademySitePage.jsx'), 'AcademySitePage');
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
const AcademyCatalog = lazy(() => import('../pages/public/AcademyLandingPage.jsx').then((m) => ({ default: () => <m.AcademyLandingPage catalogOnly /> })));
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
const BackupsPage = lazyNamed(() => import('../pages/admin/VideoAdminPages.jsx'), 'BackupsPage');
const VideoUsagePage = lazyNamed(() => import('../pages/admin/VideoAdminPages.jsx'), 'VideoUsagePage');
const AdminsPage = lazyNamed(() => import('../pages/admin/AdminsPage.jsx'), 'AdminsPage');
const AuditLogsPage = lazyNamed(() => import('../pages/admin/AuditLogsPage.jsx'), 'AuditLogsPage');
const CategoriesPage = lazyNamed(() => import('../pages/admin/ContentPages.jsx'), 'CategoriesPage');
const AnnouncementsPage = lazyNamed(() => import('../pages/admin/ContentPages.jsx'), 'AnnouncementsPage');
const SupportInboxPage = lazyNamed(() => import('../pages/support/SupportInboxPage.jsx'), 'SupportInboxPage');
const StaffTicketPage = lazyNamed(() => import('../pages/support/StaffTicketPage.jsx'), 'StaffTicketPage');
const SupportReportPage = lazyNamed(() => import('../pages/support/SupportReportPage.jsx'), 'SupportReportPage');
const FinanceDashboardPage = lazyNamed(() => import('../pages/finance/FinanceDashboardPage.jsx'), 'FinanceDashboardPage');
const CreatorDashboardPage = lazyNamed(() => import('../pages/creator/CreatorDashboardPage.jsx'), 'CreatorDashboardPage');
const OnboardingPage = lazyNamed(() => import('../pages/creator/OnboardingPage.jsx'), 'OnboardingPage');
const AcademySettingsPage = lazyNamed(() => import('../pages/creator/AcademySettingsPage.jsx'), 'AcademySettingsPage');
const CoursesPage = lazyNamed(() => import('../pages/creator/CoursesPage.jsx'), 'CoursesPage');
const CourseEditorPage = lazyNamed(() => import('../pages/creator/CourseEditorPage.jsx'), 'CourseEditorPage');
const StaffPage = lazyNamed(() => import('../pages/creator/StaffPage.jsx'), 'StaffPage');
const InvitePage = lazyNamed(() => import('../pages/creator/InvitePage.jsx'), 'InvitePage');
const CourseLandingPage = lazyNamed(() => import('../pages/public/CourseLandingPage.jsx'), 'CourseLandingPage');
const VerifyCertificatePage = lazyNamed(() => import('../pages/public/VerifyCertificatePage.jsx'), 'VerifyCertificatePage');
const PlayerPage = lazyNamed(() => import('../pages/student/PlayerPage.jsx'), 'PlayerPage');
const StudentCertificatesPage = lazyNamed(() => import('../pages/student/CertificatesPage.jsx'), 'StudentCertificatesPage');
const StudentsPage = lazyNamed(() => import('../pages/creator/StudentsPage.jsx'), 'StudentsPage');
const DiscussionsPage = lazyNamed(() => import('../pages/creator/DiscussionsPage.jsx'), 'DiscussionsPage');
const CertificatesAdminPage = lazyNamed(() => import('../pages/creator/CertificatesAdminPage.jsx'), 'CertificatesAdminPage');
const VideosPage = lazyNamed(() => import('../pages/creator/VideosPage.jsx'), 'VideosPage');
const WebsitePage = lazyNamed(() => import('../pages/creator/WebsitePage.jsx'), 'WebsitePage');
const PageBuilderPage = lazyNamed(() => import('../pages/creator/PageBuilderPage.jsx'), 'PageBuilderPage');
const PaymentsPage = lazyNamed(() => import('../pages/creator/PaymentsPage.jsx'), 'PaymentsPage');
const CouponsPage = lazyNamed(() => import('../pages/creator/CouponsPage.jsx'), 'CouponsPage');
const OrdersPage = lazyNamed(() => import('../pages/creator/OrdersPage.jsx'), 'OrdersPage');
const TransactionsPage = lazyNamed(() => import('../pages/creator/OrdersPage.jsx'), 'TransactionsPage');
const OrderDetailPage = lazyNamed(() => import('../pages/creator/OrderDetailPage.jsx'), 'OrderDetailPage');
const QuestionBankPage = lazyNamed(() => import('../pages/creator/QuestionBankPage.jsx'), 'QuestionBankPage');
const ReviewsPage = lazyNamed(() => import('../pages/creator/ReviewsPage.jsx'), 'ReviewsPage');
const BundlesPage = lazyNamed(() => import('../pages/creator/BundlesPage.jsx'), 'BundlesPage');
const BundlePage = lazyNamed(() => import('../pages/public/BundlePage.jsx'), 'BundlePage');
const CartPage = lazyNamed(() => import('../pages/student/CartPage.jsx'), 'CartPage');
const CheckoutPage = lazyNamed(() => import('../pages/student/CheckoutPage.jsx'), 'CheckoutPage');
const OrderStatusPage = lazyNamed(() => import('../pages/student/OrdersPages.jsx'), 'OrderStatusPage');
const StudentOrdersPage = lazyNamed(() => import('../pages/student/OrdersPages.jsx'), 'StudentOrdersPage');
const LiveClassesPage = lazyNamed(() => import('../pages/creator/LiveClassesPage.jsx'), 'LiveClassesPage');
const LiveClassDetailPage = lazyNamed(() => import('../pages/creator/LiveClassesPage.jsx'), 'LiveClassDetailPage');
const BatchesPage = lazyNamed(() => import('../pages/creator/BatchesPage.jsx'), 'BatchesPage');
const HostRoomPage = lazyNamed(() => import('../pages/live/LivePages.jsx'), 'HostRoomPage');
const StudentRoomPage = lazyNamed(() => import('../pages/live/LivePages.jsx'), 'StudentRoomPage');
const StudentLivePage = lazyNamed(() => import('../pages/live/LivePages.jsx'), 'StudentLivePage');
const WebinarPage = lazyNamed(() => import('../pages/live/LivePages.jsx'), 'WebinarPage');
const TicketPage = lazyNamed(() => import('../pages/live/LivePages.jsx'), 'TicketPage');
const NotificationSettingsPage = lazyNamed(() => import('../pages/account/NotificationSettingsPage.jsx'), 'NotificationSettingsPage');
const MarketingPage = lazyNamed(() => import('../pages/creator/MarketingPage.jsx'), 'MarketingPage');
const AffiliatesPage = lazyNamed(() => import('../pages/creator/AffiliatesPage.jsx'), 'AffiliatesPage');
const StudentAffiliatePage = lazyNamed(() => import('../pages/creator/AffiliatesPage.jsx'), 'StudentAffiliatePage');
const CommunityFeedPage = lazyNamed(() => import('../pages/community/CommunityPages.jsx'), 'CommunityFeedPage');
const CommunityPostPage = lazyNamed(() => import('../pages/community/CommunityPages.jsx'), 'CommunityPostPage');
const StudentCommunitiesPage = lazyNamed(() => import('../pages/community/CommunityPages.jsx'), 'StudentCommunitiesPage');
const CreatorCommunitiesPage = lazyNamed(() => import('../pages/community/CommunityPages.jsx'), 'CreatorCommunitiesPage');
const AnalyticsPage = lazyNamed(() => import('../pages/creator/AnalyticsPage.jsx'), 'AnalyticsPage');
const AiStudioPage = lazyNamed(() => import('../pages/creator/AiStudioPage.jsx'), 'AiStudioPage');
const CreatorMembershipsPage = lazyNamed(() => import('../pages/community/MembershipsPages.jsx'), 'CreatorMembershipsPage');
const PublicMembershipsPage = lazyNamed(() => import('../pages/community/MembershipsPages.jsx'), 'PublicMembershipsPage');
const SubscriptionsAdminPage = lazyNamed(() => import('../pages/admin/SubscriptionsAdminPage.jsx'), 'SubscriptionsAdminPage');
const PlatformTransactionsPage = lazyNamed(() => import('../pages/finance/FinanceDashboardPage.jsx'), 'PlatformTransactionsPage');
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
  { path: '/verify', element: page(VerifyCertificatePage) },
  { path: '/verify/:number', element: page(VerifyCertificatePage) },
];

export function buildRoutes(surface = getSurface()) {
  const platform = [
    { path: '/', element: page(PlatformLandingPage) },
    { element: <GuestOnly />, children: [{ path: '/login', element: page(LoginPage) }, { path: '/signup', element: page(SignupPage) }] },
    ...sharedAuthRoutes,
    { path: '/invite', element: page(InvitePage) },
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
            { path: '/super-admin/subscriptions', element: page(SubscriptionsAdminPage) },
            { path: '/super-admin/plans/new', element: page(PlanEditorPage) },
            { path: '/super-admin/plans/:id', element: page(PlanEditorPage) },
            { path: '/super-admin/settings', element: page(SettingsPage) },
            { path: '/super-admin/backups', element: page(BackupsPage) },
            { path: '/super-admin/video-usage', element: page(VideoUsagePage) },
            { path: '/super-admin/admins', element: page(AdminsPage) },
            { path: '/super-admin/audit-logs', element: page(AuditLogsPage) },
            { path: '/super-admin/categories', element: page(CategoriesPage) },
            { path: '/super-admin/announcements', element: page(AnnouncementsPage) },
            { path: '/super-admin/status', element: page(SystemStatusPage) },
            { path: '/super-admin/design-system', element: page(DesignSystemPage) },
            { path: '/super-admin/account/security', element: page(SecurityPage, { breadcrumbs: [{ label: 'System' }] }) },
            { path: '/super-admin/account/notifications', element: page(NotificationSettingsPage, { breadcrumbs: [{ label: 'Account' }] }) },
            ...Object.entries(PREVIEW_LAYOUTS).map(([key]) => ({ path: `/super-admin/preview/${key}`, element: <Navigate to={`/preview/${key}`} replace /> })),
          ],
        },
        ...Object.entries(PREVIEW_LAYOUTS).map(([key, Layout]) => ({ path: `/preview/${key}`, element: <Layout />, children: [{ index: true, element: page(LayoutPreviewPage) }] })),
        {
          element: <FinanceLayout />,
          children: [{ path: '/finance', element: page(FinanceDashboardPage) }, { path: '/finance/transactions', element: page(PlatformTransactionsPage) }, { path: '/finance/billing', element: page(SubscriptionsAdminPage) }],
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
            { path: '/creator', element: page(CreatorDashboardPage) },
            { path: '/creator/overview', element: page(WorkspaceHomePage) },
            { path: '/creator/onboarding', element: page(OnboardingPage) },
            { path: '/creator/academy', element: page(AcademySettingsPage) },
            { path: '/creator/courses', element: page(CoursesPage) },
            { path: '/creator/courses/:id', element: page(CourseEditorPage) },
            { path: '/creator/staff', element: page(StaffPage) },
            { path: '/creator/students', element: page(StudentsPage) },
            { path: '/creator/videos', element: page(VideosPage) },
            { path: '/creator/payments', element: page(PaymentsPage) },
            { path: '/creator/coupons', element: page(CouponsPage) },
            { path: '/creator/bundles', element: page(BundlesPage) },
            { path: '/creator/reviews', element: page(ReviewsPage) },
            { path: '/creator/question-bank', element: page(QuestionBankPage) },
            { path: '/creator/orders', element: page(OrdersPage) },
            { path: '/creator/orders/:id', element: page(OrderDetailPage) },
            { path: '/creator/transactions', element: page(TransactionsPage) },
            { path: '/creator/live', element: page(LiveClassesPage) },
            { path: '/creator/live/:id', element: page(LiveClassDetailPage) },
            { path: '/creator/batches', element: page(BatchesPage) },
            { path: '/creator/marketing', element: page(MarketingPage) },
            { path: '/creator/affiliates', element: page(AffiliatesPage) },
            { path: '/creator/communities', element: page(CreatorCommunitiesPage) },
            { path: '/creator/communities/:id', element: page(CommunityFeedPage, { staff: true }) },
            { path: '/creator/communities/:id/posts/:postId', element: page(CommunityPostPage, { staff: true }) },
            { path: '/creator/memberships', element: page(CreatorMembershipsPage) },
            { path: '/creator/analytics', element: page(AnalyticsPage) },
            { path: '/creator/ai', element: page(AiStudioPage) },
            { path: '/creator/discussions', element: page(DiscussionsPage) },
            { path: '/creator/certificates', element: page(CertificatesAdminPage) },
            { path: '/creator/website', element: page(WebsitePage) },
            { path: '/creator/website/pages/:id', element: page(PageBuilderPage) },
            { path: '/creator/domains', element: page(DomainsPage) },
            { path: '/creator/billing', element: page(BillingPage) },
            { path: '/creator/support', element: page(CreatorSupportPage) },
            { path: '/creator/support/:id', element: page(CreatorTicketPage) },
            { path: '/creator/account/security', element: page(SecurityPage, { breadcrumbs: [{ label: 'Workspace' }] }) },
            { path: '/creator/account/notifications', element: page(NotificationSettingsPage, { breadcrumbs: [{ label: 'Account' }] }) },
          ],
        },
        { path: '/creator/live/sessions/:id/room', element: page(HostRoomPage) },
      ],
    },
    { element: <RequireAuth />, children: [{ path: '/account/security', element: <NoWorkspacePage /> }] },
  ];

  const academy = [
    { path: '/', element: page(AcademySitePage) },
    { path: '/p/:slug', element: page(AcademySitePage) },
    { path: '/courses', element: page(AcademyCatalog) },
    { path: '/courses/:slug', element: page(CourseLandingPage) },
    { path: '/bundles/:slug', element: page(BundlePage) },
    { path: '/memberships', element: page(PublicMembershipsPage) },
    { path: '/webinars/:slug', element: page(WebinarPage) },
    { path: '/live/ticket/:code', element: page(TicketPage) },
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
            { path: '/learn/account/notifications', element: page(NotificationSettingsPage, { breadcrumbs: [{ label: 'Account' }] }) },
            { path: '/learn/certificates', element: page(StudentCertificatesPage) },
            { path: '/learn/orders', element: page(StudentOrdersPage) },
            { path: '/learn/orders/:id', element: page(OrderStatusPage) },
            { path: '/learn/live', element: page(StudentLivePage) },
            { path: '/learn/affiliate', element: page(StudentAffiliatePage) },
            { path: '/learn/communities', element: page(StudentCommunitiesPage) },
            { path: '/learn/communities/:id', element: page(CommunityFeedPage) },
            { path: '/learn/communities/:id/posts/:postId', element: page(CommunityPostPage) },
          ],
        },
        { path: '/learn/courses/:courseId', element: page(PlayerPage) },
        { path: '/checkout/:slug', element: page(CheckoutPage) },
        { path: '/checkout/membership/:planId', element: page(CheckoutPage) },
        { path: '/checkout/bundle/:bundleSlug', element: page(CheckoutPage) },
        { path: '/checkout/webinar/:webinarSlug', element: page(CheckoutPage) },
        { path: '/cart/checkout', element: page(CheckoutPage) },
        { path: '/cart', element: page(CartPage) },
        { path: '/learn/live/:id', element: page(StudentRoomPage) },
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
