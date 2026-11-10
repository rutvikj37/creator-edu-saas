import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { PlatformLandingPage } from './PlatformLandingPage.jsx';
import { demoVideo } from './landing/video.js';
import { planFeatureLines, yearlySaving } from './landing/pricing.js';
import { systemApi } from '../../services/api/system.js';
import { creatorApi } from '../../services/api/platform.js';

vi.mock('../../services/api/system.js', () => ({ systemApi: { info: vi.fn() } }));
vi.mock('../../services/api/platform.js', () => ({ creatorApi: { publicPlans: vi.fn() } }));
vi.mock('../../context/AuthContext.jsx', () => ({ useAuth: () => ({ status: 'anonymous' }) }));

const PLANS = [
  { id: 'p1', code: 'starter', name: 'Starter', description: 'For your first course', trialDays: 14, isDefault: true,
    features: [{ featureKey: 'courses.max', enabled: true, limitValue: 5 }, { featureKey: 'students.max', enabled: true, limitValue: null }, { featureKey: 'live_classes', enabled: true, limitValue: null }, { featureKey: 'affiliates', enabled: false, limitValue: null }, { featureKey: 'commission.percent', enabled: true, limitValue: 5 }],
    prices: [{ id: 'a', interval: 'MONTH', currency: 'INR', amount: '999' }, { id: 'b', interval: 'YEAR', currency: 'INR', amount: '9590.40' }] },
  { id: 'p2', code: 'pro', name: 'Pro', description: null, trialDays: 0, isDefault: false,
    features: [{ featureKey: 'commission.percent', enabled: true, limitValue: 0 }],
    prices: [{ id: 'c', interval: 'MONTH', currency: 'INR', amount: '2999' }] },
];

function show(props) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><PlatformLandingPage {...props} /></MemoryRouter></QueryClientProvider>);
}
afterEach(() => vi.clearAllMocks());

it('shows the trial offer, real plan prices and features, and search metadata', async () => {
  systemApi.info.mockResolvedValue({ name: 'Acme Learn', branding: { demoVideoUrl: 'https://youtu.be/abcdefghijk' } });
  creatorApi.publicPlans.mockResolvedValue(PLANS);
  show();
  expect(await screen.findByRole('heading', { level: 1, name: /Launch your online academy/ })).toBeInTheDocument();
  const starter = (await screen.findByRole('heading', { level: 3, name: 'Starter' })).closest('article');
  expect(within(starter).getByText('₹999')).toBeInTheDocument();
  expect(within(starter).getByText('14-day free trial')).toBeInTheDocument();
  expect(within(starter).getByText('5 courses')).toBeInTheDocument();
  expect(within(starter).getByText('Unlimited students')).toBeInTheDocument();
  expect(within(starter).getByText('5% transaction commission')).toBeInTheDocument();
  expect(within(starter).queryByText('Affiliate program')).not.toBeInTheDocument();
  expect(within(starter).getByRole('link', { name: 'Start free trial' })).toHaveAttribute('href', '/signup');
  expect(screen.getAllByText('14-day free trial').length).toBeGreaterThan(1);

  await userEvent.click(screen.getByRole('button', { name: /Yearly/ }));
  expect(screen.getByText(/save up to 20%/)).toBeInTheDocument();
  expect(within(starter).getByText('₹9,590.40')).toBeInTheDocument();
  // A plan with no yearly price keeps showing its monthly one.
  expect(screen.getByText('₹2,999')).toBeInTheDocument();

  // The video only loads once asked for.
  expect(document.querySelector('iframe')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Play the demo' }));
  expect(screen.getByTitle('Acme Learn product demo')).toHaveAttribute('src', expect.stringContaining('https://www.youtube-nocookie.com/embed/abcdefghijk'));

  expect(document.title).toBe('Acme Learn — Create & sell online courses, live classes and coaching');
  expect(document.querySelector('meta[name="description"]').content).toContain('Acme Learn');
  expect(document.querySelector('link[rel="canonical"]').href).toBe(`${window.location.origin}/`);
  const graph = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@graph'];
  expect(graph.find((n) => n['@type'] === 'SoftwareApplication').offers).toMatchObject({ priceCurrency: 'INR', lowPrice: 999, highPrice: 2999, offerCount: 2 });
  expect(graph.find((n) => n['@type'] === 'FAQPage').mainEntity.length).toBeGreaterThan(4);
});

it('hides pricing and the demo when there are no plans or video, and never promises a trial', async () => {
  systemApi.info.mockResolvedValue({ name: 'Acme Learn', branding: {} });
  creatorApi.publicPlans.mockResolvedValue([]);
  show();
  expect((await screen.findAllByRole('link', { name: /Start free/ })).length).toBeGreaterThan(0);
  expect(screen.queryByText(/free trial/)).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /Simple plans/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Play the demo' })).not.toBeInTheDocument();
});

it('only embeds video from allowed sources', () => {
  expect(demoVideo('https://www.youtube.com/watch?v=abcdefghijk').src).toContain('youtube-nocookie.com/embed/abcdefghijk');
  expect(demoVideo('https://vimeo.com/123456789').src).toBe('https://player.vimeo.com/video/123456789?autoplay=1');
  expect(demoVideo('https://cdn.example.com/demo.mp4')).toEqual({ kind: 'file', src: 'https://cdn.example.com/demo.mp4' });
  expect(demoVideo('http://youtu.be/abcdefghijk')).toBeNull();
  expect(demoVideo('https://evil.example.com/watch?v=abcdefghijk')).toBeNull();
  expect(demoVideo('javascript:alert(1)')).toBeNull();
  expect(yearlySaving(PLANS[1], 'INR')).toBeNull();
  expect(planFeatureLines(PLANS[1])).toEqual(['No transaction commission']);
});
