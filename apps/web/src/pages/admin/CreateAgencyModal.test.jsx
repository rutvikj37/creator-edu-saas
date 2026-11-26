import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { CreateAgencyModal } from './CreateAgencyModal.jsx';
import { platformApi } from '../../services/api/platform.js';

vi.mock('../../services/api/platform.js', () => ({
  platformApi: {
    plans: vi.fn(),
    createTenant: vi.fn(),
  },
}));

const mockPlans = [
  {
    id: 'p-trial',
    code: 'trial',
    name: 'Free Trial',
    trialDays: 14,
    prices: [],
  },
  {
    id: 'p-growth',
    code: 'growth',
    name: 'Growth',
    trialDays: 0,
    prices: [
      { id: 'price-growth-6', interval: 'SIX_MONTH', currency: 'INR', amount: '16999' },
      { id: 'price-growth-y', interval: 'YEAR', currency: 'INR', amount: '19999' },
    ],
  },
  {
    id: 'p-pro',
    code: 'pro',
    name: 'Pro',
    trialDays: 0,
    prices: [
      { id: 'price-pro-6', interval: 'SIX_MONTH', currency: 'INR', amount: '16999' },
      { id: 'price-pro-y', interval: 'YEAR', currency: 'INR', amount: '19999' },
    ],
  },
];

describe('CreateAgencyModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformApi.plans.mockResolvedValue(mockPlans);
  });

  it('renders modal and sets dynamic price and paid plans', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CreateAgencyModal open={true} onClose={vi.fn()} onSuccess={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('option', { name: 'Growth' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Pro' })).toBeInTheDocument();

    // Verify Free trial plan is NOT an option in Paid mode
    expect(screen.queryByRole('option', { name: 'Free Trial' })).not.toBeInTheDocument();

    // Verify dynamic hint displays months access
    expect(screen.getByText(/12 months access/i)).toBeInTheDocument();
  });

  it('switches to free trial and allows selecting trial days', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CreateAgencyModal open={true} onClose={vi.fn()} onSuccess={vi.fn()} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: 'Growth' });

    // Click "Free trial" radio
    const trialRadio = screen.getByLabelText(/Free trial/i);
    fireEvent.click(trialRadio);

    // Verify trial days field and presets appear
    expect(screen.getByLabelText(/Trial days \*/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '7 days' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30 days' })).toBeInTheDocument();

    // Click 30 days preset
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    expect(screen.getByLabelText(/Trial days \*/i).value).toBe('30');
    expect(screen.getByText(/30 days free access/i)).toBeInTheDocument();
  });
});
