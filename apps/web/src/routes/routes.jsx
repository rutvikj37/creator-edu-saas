import { lazy, Suspense } from 'react';
import { Spinner } from '../components/ui/index.js';
import { RouteError } from './RouteError.jsx';
import { HomePage } from '../pages/HomePage.jsx';
import { NotFoundPage } from '../pages/NotFoundPage.jsx';
import {
  AffiliateLayout, CreatorLayout, FinanceLayout, StudentLayout, SuperAdminLayout, SupportLayout,
} from '../layouts/PanelLayouts.jsx';

// Route-level code splitting: each panel's screens load only when visited.
const SystemStatusPage = lazy(() => import('../pages/system/SystemStatusPage.jsx').then((m) => ({ default: m.SystemStatusPage })));
const DesignSystemPage = lazy(() => import('../pages/system/design-system/DesignSystemPage.jsx').then((m) => ({ default: m.DesignSystemPage })));
const LayoutPreviewPage = lazy(() => import('../pages/preview/LayoutPreviewPage.jsx').then((m) => ({ default: m.LayoutPreviewPage })));

const page = (Component) => (
  <Suspense fallback={<div className="grid min-h-[40vh] place-items-center"><Spinner /></div>}>
    <Component />
  </Suspense>
);

const PREVIEW_LAYOUTS = {
  'super-admin': SuperAdminLayout,
  finance: FinanceLayout,
  support: SupportLayout,
  creator: CreatorLayout,
  student: StudentLayout,
  affiliate: AffiliateLayout,
};

export const routes = [
  { path: '/', element: <HomePage />, errorElement: <RouteError /> },
  {
    element: <SuperAdminLayout />,
    errorElement: <RouteError />,
    children: [
      { path: '/status', element: page(SystemStatusPage) },
      { path: '/design-system', element: page(DesignSystemPage) },
    ],
  },
  ...Object.entries(PREVIEW_LAYOUTS).map(([key, Layout]) => ({
    path: `/preview/${key}`,
    element: <Layout />,
    errorElement: <RouteError />,
    children: [{ index: true, element: page(LayoutPreviewPage) }],
  })),
  { path: '*', element: <NotFoundPage /> },
];
