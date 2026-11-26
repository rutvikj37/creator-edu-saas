import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { PlatformLandingPage } from './PlatformLandingPage.jsx';
import { demoVideo } from './landing/video.js';
import { planFeatureLines } from './landing/pricing.js';
import { systemApi } from '../../services/api/system.js';
import { creatorApi } from '../../services/api/platform.js';

vi.mock('../../services/api/system.js', () => ({ systemApi: { info: vi.fn() } }));
vi.mock('../../services/api/platform.js', () => ({ creatorApi: { publicPlans: vi.fn() } }));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ status: 'anonymous' }) }));

const PLANS = [
  { id: 'p1', code: 'grow', name: 'Grow', description: 'For creators ready to sell', trialDays: 0, isDefault: true,
    features: [{ featureKey: 'white_label', enabled: true, limitValue: null }],
    prices: [{ id: 'b', interval: 'SIX_MONTH', currency: 'INR', amount: '16999' }] },
  { id: 'p2', code: 'rise', name: 'Rise', description: 'White-label academy', trialDays: 0, isDefault: false,
    features: [{ featureKey: 'white_label', enabled: true, limitValue: null }],
    prices: [{ id: 'd', interval: 'YEAR', currency: 'INR', amount: '19999' }] },
];

function show(props) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><PlatformLandingPage {...props} /></MemoryRouter></QueryClientProvider>);
}
afterEach(() => vi.clearAllMocks());

it('shows brand-first hero, Grow 6-mo / Rise yearly, GST, and identical modules', async () => {
  systemApi.info.mockResolvedValue({ name: 'TechX LMS', branding: { demoVideoUrl: 'https://youtu.be/abcdefghijk' } });
  creatorApi.publicPlans.mockResolvedValue(PLANS);
  show();
  expect(await screen.findByRole('heading', { level: 1, name: /Sell your academy on your brand/ })).toBeInTheDocument();
  expect(screen.getAllByText('TechX LMS').length).toBeGreaterThan(0);
  expect(screen.queryByText(/free trial/i)).not.toBeInTheDocument();

  expect(screen.getByRole('heading', { name: /Modules included with Grow and Rise/ })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /We launch your academy with you/ })).toBeInTheDocument();
  expect(screen.getByText('Onboard configured for you')).toBeInTheDocument();
  expect(screen.getByText('Go live and sell')).toBeInTheDocument();
  expect(screen.getByText('Unlimited Contacts')).toBeInTheDocument();
  expect(screen.getByText('Third Party Integrations')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Get started/i })).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Sign in' }).length).toBeGreaterThan(0);

  const grow = (await screen.findByRole('heading', { level: 3, name: 'Grow' })).closest('article');
  expect(within(grow).getByText('₹16,999')).toBeInTheDocument();
  expect(within(grow).getByText('/ 6 months')).toBeInTheDocument();
  expect(within(grow).getByText('+ 18% GST extra')).toBeInTheDocument();
  expect(within(grow).getByText('White label')).toBeInTheDocument();
  expect(within(grow).getByText('Everything included')).toBeInTheDocument();
  expect(within(grow).getByRole('link', { name: 'Sign in' })).toBeInTheDocument();

  const rise = screen.getByRole('heading', { level: 3, name: 'Rise' }).closest('article');
  expect(within(rise).getByText('₹19,999')).toBeInTheDocument();
  expect(within(rise).getByText('/ year')).toBeInTheDocument();
  expect(within(rise).getByText('White label')).toBeInTheDocument();
  expect(screen.getByText(/18% GST is charged extra/i)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Play the demo' }));
  expect(screen.getByTitle('TechX LMS product demo')).toHaveAttribute('src', expect.stringContaining('youtube-nocookie.com/embed/abcdefghijk'));
});

it('hides pricing when empty and never promises a trial', async () => {
  systemApi.info.mockResolvedValue({ name: 'TechX LMS', branding: {} });
  creatorApi.publicPlans.mockResolvedValue([]);
  show();
  expect((await screen.findAllByRole('link', { name: 'Sign in' })).length).toBeGreaterThan(0);
  expect(screen.queryByRole('link', { name: /Get started/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/free trial/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /Same academy/ })).not.toBeInTheDocument();
});

it('sanitizes demo video sources and maps identical launch modules', () => {
  expect(demoVideo('https://www.youtube.com/watch?v=abcdefghijk').src).toContain('youtube-nocookie.com');
  expect(demoVideo('javascript:alert(1)')).toBeNull();
  expect(planFeatureLines(PLANS[0])).toContain('Unlimited Contacts');
  expect(planFeatureLines(PLANS[0])).toContain('White label');
  expect(planFeatureLines(PLANS[1])).toEqual(planFeatureLines(PLANS[0]));
});
