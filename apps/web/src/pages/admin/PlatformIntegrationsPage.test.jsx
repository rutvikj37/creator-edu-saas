import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { PlatformIntegrationsPage } from './PlatformIntegrationsPage.jsx';
import { platformApi } from '../../services/api/platform.js';

vi.mock('../../services/api/platform.js', () => ({
  platformApi: {
    settings: vi.fn(),
    updateSettings: vi.fn(),
  },
}));

describe('PlatformIntegrationsPage', () => {
  it('renders integrations catalog and opens config modal', async () => {
    platformApi.settings.mockResolvedValue([
      {
        group: 'payments',
        items: [{ key: 'payments.razorpayKeyId', value: 'rzp_test_12345678' }],
      },
    ]);

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PlatformIntegrationsPage />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Razorpay Payment Gateway')).toBeInTheDocument();
    expect(screen.getByText('Transactional Mail (SMTP / Mailpit)')).toBeInTheDocument();
    expect(await screen.findByText('Connected')).toBeInTheDocument();
  });
});
