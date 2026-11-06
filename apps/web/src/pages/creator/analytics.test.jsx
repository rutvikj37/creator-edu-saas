import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { AnalyticsPage } from './AnalyticsPage.jsx';
import { analyticsApi } from '../../services/api/analytics.js';
import { saveBlob } from '../../utils/download.js';

vi.mock('../../services/api/analytics.js', () => ({ analyticsApi: { overview: vi.fn(), courses: vi.fn(), gst: vi.fn(), exportCsv: vi.fn(), conversions: vi.fn() } }));
vi.mock('../../services/api/creator.js', () => ({ coursesApi: { list: vi.fn(async () => ({ items: [{ id: 'c1', title: 'SQL' }] })) } }));
vi.mock('../../utils/download.js', () => ({ saveBlob: vi.fn() }));

const wrap = (path) => {
  const router = createMemoryRouter([{ path: '/creator/analytics', element: <AnalyticsPage /> }], { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
};

it('overview shows ledger totals and top courses for the chosen range', async () => {
  analyticsApi.overview.mockResolvedValue({
    range: { from: '2026-10-01', to: '2026-10-07', timezone: 'Asia/Kolkata', currency: 'INR' },
    money: { totals: [{ currency: 'INR', gross: '4720.00', refunds: '590.00', net: '3000.00' }] },
    counts: { newStudents: 4, enrollments: 4, completions: 1, leads: 0, paidOrders: 4 },
    enrollmentsBySource: { PURCHASE: 4 },
    series: [{ date: '2026-10-07', revenue: '4130.00', enrollments: 4, students: 4 }],
    topCourses: [{ courseId: 'c1', title: 'GST course', sales: 4, revenue: '4720' }],
  });
  wrap('/creator/analytics?from=2026-10-01&to=2026-10-07');
  expect((await screen.findAllByText('₹4,720.00')).length).toBeGreaterThan(0);
  expect(screen.getByText('₹590.00 refunded')).toBeInTheDocument();
  expect((await screen.findAllByText('GST course'))[0]).toBeInTheDocument();
  expect(analyticsApi.overview).toHaveBeenCalledWith({ from: '2026-10-01', to: '2026-10-07' });
});

it('GST tab shows the rate summary and downloads the CSV for the range', async () => {
  analyticsApi.gst.mockResolvedValue({ sellerGstin: '24ABCDE1234F1Z5', summary: [{ currency: 'INR', rate: 18, documents: 5, taxable: 3500, igst: 270, cgst: 180, sgst: 180, total: 4130 }], rows: [] });
  analyticsApi.exportCsv.mockResolvedValue(new Blob(['x']));
  wrap('/creator/analytics?tab=gst&from=2026-10-01&to=2026-10-31');
  expect((await screen.findAllByText('₹3,500.00'))[0]).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
  await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'gst-2026-10-01-to-2026-10-31.csv'));
  expect(analyticsApi.exportCsv).toHaveBeenCalledWith('gst', { from: '2026-10-01', to: '2026-10-31' });
});

it('course analytics explain the plan requirement instead of erroring', async () => {
  analyticsApi.courses.mockRejectedValue(Object.assign(new Error('Not in plan'), { status: 403 }));
  wrap('/creator/analytics?tab=courses');
  expect(await screen.findByText('Course analytics are on higher plans')).toBeInTheDocument();
});

it('conversions tab shows the funnel, sources with campaigns, items and pages', async () => {
  analyticsApi.conversions.mockResolvedValue({
    currency: 'INR', range: { from: '2026-10-08', to: '2026-11-06' },
    funnel: { visitors: 3, pageViews: 4, itemViewers: 2, checkoutStarted: 2, paidOrders: 1, attributedOrders: 1, revenue: '999.00', viewToCheckout: 100, checkoutToPaid: 50, conversionRate: 33.3 },
    sources: [{ source: 'instagram / social', visitors: 1, checkouts: 1, sales: 1, revenue: '999.00', conversionRate: 100, campaigns: ['diwali-sale'] }, { source: 'Direct', visitors: 2, checkouts: 1, sales: 0, revenue: '0', conversionRate: 0, campaigns: [] }],
    items: [{ type: 'course', id: 'c1', title: 'Stock Market Basics', views: 2, visitors: 2, checkouts: 2, sales: 1, revenue: '999.00', conversionRate: 50 }],
    pages: [{ path: '/courses/stock-market-basics', views: 2, visitors: 2, sales: 0, revenue: '0', conversionRate: 0 }],
    daily: [{ day: '2026-11-06', visitors: 3, checkouts: 2, sales: 1 }],
  });
  wrap('/creator/analytics?tab=conversions');
  expect(await screen.findByText('33.3%')).toBeInTheDocument();
  expect(screen.getAllByText('instagram / social')[0]).toBeInTheDocument();
  expect(screen.getAllByText('diwali-sale')[0]).toBeInTheDocument();
  expect(screen.getAllByText('Stock Market Basics')[0]).toBeInTheDocument();
  expect(screen.getAllByText('/courses/stock-market-basics')[0]).toBeInTheDocument();
  expect(screen.getByText('50% of previous step')).toBeInTheDocument();
  expect(analyticsApi.conversions).toHaveBeenCalledWith(expect.objectContaining({ from: expect.any(String), to: expect.any(String) }));
});
