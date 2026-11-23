import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { SecurityPage } from './SecurityPage.jsx';
import { Watermark } from '../../../components/video/Watermark.jsx';
import { http } from '../../../services/api/client.js';

vi.mock('../../../services/api/client.js', () => ({ http: { get: vi.fn(), put: vi.fn() } }));
vi.mock('../../../context/AuthContext.jsx', () => ({ useAuth: () => ({ status: 'authenticated', user: { twoFactorEnabledAt: '2026-11-01T00:00:00Z' }, can: () => true }) }));

function wrap(el) {
  const router = createMemoryRouter([{ path: '/', element: el }], { initialEntries: ['/'] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
}
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

const settings = { deviceLimit: 1, teamTwoFactor: false, pdfWatermark: { enabled: false, color: '#100F0F', fixedPosition: false }, videoWatermark: { mode: 'off', showForSec: 10, everySec: 20 } };

it('security page saves the device limit, team 2FA, PDF watermark and dynamic video watermark', async () => {
  http.get.mockResolvedValue({ data: settings });
  http.put.mockImplementation(async (_u, body) => ({ data: { ...settings, ...body, pdfWatermark: { ...settings.pdfWatermark, ...(body.pdfWatermark ?? {}) }, videoWatermark: { ...settings.videoWatermark, ...(body.videoWatermark ?? {}) } } }));
  wrap(<SecurityPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Increase Device limit' }));
  await waitFor(() => expect(http.put).toHaveBeenCalledWith('/creator/settings/security', { deviceLimit: 2 }));
  await userEvent.click(screen.getByRole('switch', { name: '2-factor authentication for your team' }));
  await waitFor(() => expect(http.put).toHaveBeenCalledWith('/creator/settings/security', { teamTwoFactor: true }));
  await userEvent.click(screen.getByRole('switch', { name: /On PDF files/ }));
  await waitFor(() => expect(http.put).toHaveBeenCalledWith('/creator/settings/security', { pdfWatermark: { enabled: true } }));
  await userEvent.click(await screen.findByRole('switch', { name: 'Fixed position' }));
  await waitFor(() => expect(http.put).toHaveBeenCalledWith('/creator/settings/security', { pdfWatermark: { fixedPosition: true } }));
  await userEvent.click(screen.getByRole('radio', { name: /Dynamic watermark/ }));
  await waitFor(() => expect(http.put).toHaveBeenCalledWith('/creator/settings/security', { videoWatermark: { mode: 'dynamic' } }));
  await userEvent.click(await screen.findByRole('button', { name: 'Decrease Display for seconds' }));
  await waitFor(() => expect(http.put).toHaveBeenCalledWith('/creator/settings/security', { videoWatermark: { showForSec: 9 } }));
});

it('dynamic watermark appears for its duration, then hides until the next interval', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  http.get.mockResolvedValue({ data: { mode: 'dynamic', showForSec: 2, everySec: 5, text: 'ravi@example.com' } });
  wrap(<div className="relative"><Watermark /></div>);
  expect(await screen.findByTestId('watermark')).toHaveTextContent('ravi@example.com');
  await act(async () => { vi.advanceTimersByTime(2100); });
  expect(screen.queryByTestId('watermark')).toBeNull();
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.getByTestId('watermark')).toBeInTheDocument();
});
