import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { BackupsPage, VideoUsagePage } from './VideoAdminPages.jsx';
import { videoAdminApi } from '../../services/api/videoAdmin.js';

vi.mock('../../services/api/videoAdmin.js', () => ({ videoAdminApi: { usage: vi.fn(), backups: vi.fn(), retry: vi.fn(), restore: vi.fn(), quota: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), backupCourseDocuments: vi.fn() } }));

const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
const GB = 1024 ** 3;

beforeEach(() => vi.clearAllMocks());

it('backups: shows Drive space with a low-space warning, retries failures and restores completed backups', async () => {
  videoAdminApi.quota.mockResolvedValue({ configured: true, connected: true, email: 'owner@gmail.com', quota: { limit: 5 * 1024 * GB, usage: 4.8 * 1024 * GB, usageInDrive: 4 * 1024 * GB, usageInDriveTrash: 0, free: 0.2 * 1024 * GB, freePercent: 4, lowSpace: true, lowSpaceThresholdPercent: 10 } });
  videoAdminApi.backups.mockResolvedValue({ items: [
    { id: 'b1', kind: 'video', status: 'FAILED', errorMessage: 'Google Drive is busy', attempts: 5, originalSize: 1000, video: { title: 'Lecture 1' }, tenant: { name: 'Acme' }, restoreStatus: 'NONE' },
    { id: 'b2', kind: 'video', status: 'COMPLETED', attempts: 1, originalSize: 2000, completedAt: '2026-11-05T10:00:00Z', video: { title: 'Lecture 2' }, tenant: { name: 'Acme' }, restoreStatus: 'NONE' },
  ], meta: { page: 1, pageSize: 25, total: 2 } });
  videoAdminApi.retry.mockResolvedValue({});
  videoAdminApi.restore.mockResolvedValue({});
  wrap(<BackupsPage />);
  expect(await screen.findByText(/running out of space/)).toBeInTheDocument();
  expect(screen.getByText('owner@gmail.com')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'Google Drive space used' })).toHaveAttribute('aria-valuenow', '96');
  expect((await screen.findAllByText('Google Drive is busy'))[0]).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
  await waitFor(() => expect(videoAdminApi.retry.mock.calls[0][0]).toBe('b1'));
  await userEvent.click(screen.getAllByRole('button', { name: 'Restore' })[0]);
  await userEvent.click(await screen.findByRole('button', { name: 'Verify and restore' }));
  await waitFor(() => expect(videoAdminApi.restore.mock.calls[0][0]).toBe('b2'));
});

it('backups: explains missing configuration and offers to connect', async () => {
  videoAdminApi.quota.mockResolvedValue({ configured: true, connected: false, quota: null });
  videoAdminApi.backups.mockResolvedValue({ items: [], meta: { page: 1, pageSize: 25, total: 0 } });
  videoAdminApi.connect.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' });
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  wrap(<BackupsPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Connect Google Drive' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1'));
  vi.unstubAllGlobals();
});

it('usage: totals, cost estimate hint and academies above fair use', async () => {
  videoAdminApi.quota.mockResolvedValue({ configured: true, connected: true, quota: { free: 2 * 1024 * GB, freePercent: 40, lowSpace: false } });
  videoAdminApi.usage.mockResolvedValue({
    period: '2026-11', totals: { videos: 2, ready: 2, processing: 0, failed: 0, storageBytes: 4 * GB, deliveryBytesThisPeriod: 40 * GB, uploadsThisPeriod: 2, uploadBytesThisPeriod: 2000, processingFailuresThisPeriod: 1, estimatedCost: { amount: 20.16, currency: 'INR' } },
    backups: { byStatus: { COMPLETED: 3, FAILED: 1 }, storedBytes: 3 * GB }, provider: { storageBytes: 4 * GB, trafficBytesThisMonth: 40 * GB },
    rates: { storagePerGbMonth: 0.01, deliveryPerGb: 0.005, rateCurrency: 'USD' }, deliveryNote: 'Allocated by watch time',
    tenants: [{ tenant: { id: 't1', name: 'Acme Academy' }, videos: 1, storageBytes: 3 * GB, deliveryBytes: 30 * GB, watchSeconds: 7200, estimatedCost: { amount: 15.12, currency: 'INR' }, overFairUse: true }],
  });
  wrap(<VideoUsagePage />);
  expect(await screen.findByText('₹20.16')).toBeInTheDocument();
  expect(screen.getByText('3 / 4')).toBeInTheDocument();
  expect((await screen.findAllByText('Acme Academy'))[0]).toBeInTheDocument();
  expect(screen.getAllByText('Above fair use')[0]).toBeInTheDocument();
  expect(screen.getByText('2.00 TB')).toBeInTheDocument();
});
