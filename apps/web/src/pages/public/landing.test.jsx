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
  { id: 'p1', code: 'grow', name: 'Grow', description: 'For creators ready to sell', trialDays: 0, isDefault: true,
    features: [{ featureKey: 'white_label', enabled: false, limitValue: null }, { featureKey: 'live_classes', enabled: true, limitValue: null }],
    prices: [{ id: 'a', interval: 'SIX_MONTH', currency: 'INR', amount: '15999' }, { id: 'b', interval: 'YEAR', currency: 'INR', amount: '19999' }] },
  { id: 'p2', code: 'rise', name: 'Rise', description: 'White-label academy', trialDays: 0, isDefault: false,
    features: [{ featureKey: 'white_label', enabled: true, limitValue: null }, { featureKey: 'commission.percent', enabled: true, limitValue: 0 }],
    prices: [{ id: 'c', interval: 'SIX_MONTH', currency: 'INR', amount: '15999' }, { id: 'd', interval: 'YEAR', currency: 'INR', amount: '19999' }] },
];

function show(props) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><PlatformLandingPage {...props} /></MemoryRouter></QueryClientProvider>);
}
afterEach(() => vi.clearAllMocks());

it('shows Grow/Rise launch pricing and modules without trial copy', async () => {
  systemApi.info.mockResolvedValue({ name: 'TechX LMS', branding: { demoVideoUrl: 'https://youtu.be/abcdefghijk' } });
  creatorApi.publicPlans.mockResolvedValue(PLANS);
  show();
  expect(await screen.findByRole('heading', { level: 1, name: /Sell your academy on your brand/ })).toBeInTheDocument();
  expect(screen.queryByText(/free trial/i)).not.toBeInTheDocument();

  const grow = (await screen.findByRole('heading', { level: 3, name: 'Grow' })).closest('article');
  expect(within(grow).getByText('₹15,999')).toBeInTheDocument();
  expect(within(grow).getByText('Unlimited Contacts')).toBeInTheDocument();
  expect(within(grow).getByText('5,000 Marketing Emails/Month')).toBeInTheDocument();
  expect(within(grow).queryByText('White label')).not.toBeInTheDocument();
  expect(within(grow).getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/login');

  const rise = screen.getByRole('heading', { level: 3, name: 'Rise' }).closest('article');
  expect(within(rise).getByText('White label')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /12 months/ }));
  expect(screen.getByText(/save 38%/)).toBeInTheDocument();
  expect(within(grow).getByText('₹19,999')).toBeInTheDocument();

  expect(document.querySelector('iframe')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Play the demo' }));
  expect(screen.getByTitle('TechX LMS product demo')).toHaveAttribute('src', expect.stringContaining('https://www.youtube-nocookie.com/embed/abcdefghijk'));

  expect(document.title).toBe('TechX LMS — Sell courses, live classes and digital products');
  expect(document.querySelector('meta[name="description"]').content).toContain('TechX LMS');
  expect(document.querySelector('link[rel="canonical"]').href).toBe(`${window.location.origin}/`);
  const graph = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@graph'];
  expect(graph.find((n) => n['@type'] === 'SoftwareApplication').offers).toMatchObject({ priceCurrency: 'INR', lowPrice: 15999, highPrice: 19999 });
  expect(graph.find((n) => n['@type'] === 'FAQPage').mainEntity.length).toBeGreaterThan(4);
});

it('hides pricing and the demo when there are no plans or video, and never promises a trial', async () => {
  systemApi.info.mockResolvedValue({ name: 'TechX LMS', branding: {} });
  creatorApi.publicPlans.mockResolvedValue([]);
  show();
  expect((await screen.findAllByRole('link', { name: /Get started/ })).length).toBeGreaterThan(0);
  expect(screen.queryByText(/free trial/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /Grow and Rise/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Play the demo' })).not.toBeInTheDocument();
});

it('only embeds video from allowed sources and computes launch savings', () => {
  expect(demoVideo('https://www.youtube.com/watch?v=abcdefghijk').src).toContain('youtube-nocookie.com/embed/abcdefghijk');
  expect(demoVideo('https://vimeo.com/123456789').src).toBe('https://player.vimeo.com/video/123456789?autoplay=1');
  expect(demoVideo('https://cdn.example.com/demo.mp4')).toEqual({ kind: 'file', src: 'https://cdn.example.com/demo.mp4' });
  expect(demoVideo('http://youtu.be/abcdefghijk')).toBeNull();
  expect(demoVideo('https://evil.example.com/watch?v=abcdefghijk')).toBeNull();
  expect(demoVideo('javascript:alert(1)')).toBeNull();
  expect(yearlySaving(PLANS[0], 'INR')).toBe(38);
  expect(planFeatureLines(PLANS[0])).toContain('Unlimited Contacts');
  expect(planFeatureLines(PLANS[1])).toContain('White label');
});
