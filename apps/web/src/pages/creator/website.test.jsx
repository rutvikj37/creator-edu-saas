import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { WebsitePage } from './WebsitePage.jsx';
import { AcademySitePage } from '../public/AcademySitePage.jsx';
import { websiteApi } from '../../services/api/website.js';

vi.mock('../../services/api/website.js', () => ({ websiteApi: { overview: vi.fn(), saveSettings: vi.fn(), aiLanding: vi.fn(), page: vi.fn(), savePage: vi.fn(), publish: vi.fn(), versions: vi.fn(async () => []), restore: vi.fn(), previewToken: vi.fn(), layout: vi.fn(), publicPage: vi.fn() } }));
vi.mock('../../services/api/auth.js', () => ({ workspaceApi: { workspace: vi.fn(async () => ({ primaryHostname: 'meera.lvh.me' })) }, academyApi: { site: vi.fn(async () => ({ name: 'Meera Academy', theme: { primaryColor: '#0f766e' } })) } }));
vi.mock('../../services/api/creator.js', () => ({
  academyApi2: { get: vi.fn(async () => ({ primaryColor: '#0f766e' })) },
  coursesApi: { list: vi.fn(async () => ({ items: [{ id: 'c1', slug: 'mutual-funds', title: 'Mutual Funds 101', status: 'PUBLISHED', isFree: true }, { id: 'c2', slug: 'draft', title: 'Draft course', status: 'DRAFT' }] })) },
}));
vi.mock('../public/AcademyLandingPage.jsx', () => ({ AcademyHeader: () => <header>header</header>, AcademyLandingPage: () => <p>default catalogue page</p>, CourseCard: ({ c }) => <div>{c.title}</div> }));
vi.mock('../../components/forms/RichTextEditor.jsx', () => ({ RichTextEditor: () => <div>editor</div> }));

const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
const blocks = [
  { id: 'hero', type: 'hero', hidden: false, props: { heading: 'Make your salary work for you', subheading: 'Practical money courses', ctaLabel: 'Explore', ctaHref: '/courses', imageFileId: null, align: 'center' } },
  { id: 'faq', type: 'faq', hidden: false, props: { heading: 'Questions', items: [{ q: 'How do I pay?', a: 'UPI or cards.' }] } },
];

beforeEach(() => vi.clearAllMocks());

it('own website: saves the address, shows validation and gives course links', async () => {
  websiteApi.overview.mockResolvedValue({ settings: { mode: 'PLATFORM', externalUrl: null }, pages: [] });
  websiteApi.saveSettings.mockRejectedValueOnce(Object.assign(new Error('Some fields are invalid'), { details: [{ field: 'externalUrl', message: 'Use an https:// address' }] })).mockResolvedValueOnce({});
  wrap(<WebsitePage />);
  await userEvent.click(await screen.findByRole('button', { name: /My own website/ }));
  const input = screen.getByLabelText(/^Website/);
  await userEvent.type(input, 'http://meera.example');
  await userEvent.click(screen.getByRole('button', { name: 'Use my website' }));
  expect(await screen.findByText('Use an https:// address')).toBeInTheDocument();
  await userEvent.clear(input);
  await userEvent.type(input, 'https://www.meera.example');
  await userEvent.click(screen.getByRole('button', { name: 'Use my website' }));
  await waitFor(() => expect(websiteApi.saveSettings).toHaveBeenLastCalledWith({ mode: 'EXTERNAL', externalUrl: 'https://www.meera.example' }));
  expect(await screen.findByText(/meera\.lvh\.me(:\d+)?\/courses\/mutual-funds$/)).toBeInTheDocument();
  expect(screen.queryByText(/draft/)).toBeNull(); // unpublished courses are not offered
});

it('AI landing page: generates from the answers, then edit, preview and publish', async () => {
  websiteApi.overview.mockResolvedValueOnce({ settings: { mode: 'PLATFORM' }, pages: [] }).mockResolvedValue({ settings: { mode: 'PLATFORM' }, pages: [{ id: 'p1', isHome: true }] });
  websiteApi.aiLanding.mockResolvedValue({ page: { id: 'p1' }, credits: 12 });
  websiteApi.page.mockResolvedValue({ id: 'p1', isHome: true, draftBlocks: blocks, seoTitle: 'Meera', seoDescription: '', files: {}, publishedAt: null, hasUnpublishedChanges: true });
  websiteApi.savePage.mockImplementation(async (id, body) => ({ id, draftBlocks: body.draftBlocks, files: {}, seoTitle: body.seoTitle, seoDescription: body.seoDescription }));
  websiteApi.publish.mockResolvedValue({ id: 'p1', draftBlocks: blocks, files: {}, publishedAt: '2026-11-05T10:00:00Z' });
  wrap(<WebsitePage />);
  await userEvent.selectOptions(await screen.findByLabelText(/Industry/), 'Personal finance');
  await userEvent.type(screen.getByLabelText(/Who is it for/), 'Salaried professionals');
  await userEvent.selectOptions(screen.getByLabelText('Language'), 'hi');
  await userEvent.click(screen.getByRole('button', { name: 'Generate my landing page' }));
  await waitFor(() => expect(websiteApi.aiLanding).toHaveBeenCalledWith({ industry: 'Personal finance', audience: 'Salaried professionals', tone: 'friendly', language: 'hi', highlights: undefined }));
  // Editor + live preview of the generated draft.
  expect((await screen.findAllByText('Make your salary work for you'))[0]).toBeInTheDocument();
  const heading = screen.getByDisplayValue('Make your salary work for you');
  await userEvent.clear(heading);
  await userEvent.type(heading, 'Grow your money');
  expect(screen.getAllByText('Grow your money').length).toBeGreaterThan(0);
  await userEvent.click(screen.getAllByRole('button', { name: 'Remove block' })[0]);
  await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
  await waitFor(() => expect(websiteApi.publish).toHaveBeenCalledWith('p1', expect.any(String)));
  expect(websiteApi.savePage.mock.calls.at(-1)[1].draftBlocks.map((b) => b.type)).toEqual(['faq']);
});

const site = (path, routes = [{ path: '/', element: <AcademySitePage /> }, { path: '/p/:slug', element: <AcademySitePage /> }]) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
};

it('public home: redirects to the own website, renders the published landing page, or falls back', async () => {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace });
  websiteApi.layout.mockResolvedValueOnce({ mode: 'EXTERNAL', externalUrl: 'https://www.meera.example/', nav: [], hasHomePage: false });
  site('/');
  await waitFor(() => expect(replace).toHaveBeenCalledWith('https://www.meera.example/'));
  vi.unstubAllGlobals();
});

it('public home renders published blocks with SEO, and falls back without a page', async () => {
  websiteApi.layout.mockResolvedValue({ mode: 'PLATFORM', externalUrl: null, nav: [{ label: 'Courses', href: '/courses' }], hasHomePage: true, template: 'classic', footer: { text: '© Meera', links: [] } });
  websiteApi.publicPage.mockResolvedValue({ title: 'Home', blocks, data: { files: {}, courses: {} }, seo: { title: 'Meera Academy — money skills', description: 'Learn money skills' }, preview: false });
  site('/');
  expect(await screen.findByText('Make your salary work for you')).toBeInTheDocument();
  await waitFor(() => expect(document.title).toBe('Meera Academy — money skills'));
  expect(document.querySelector('meta[name="description"]').getAttribute('content')).toBe('Learn money skills');
});

it('public home without a landing page shows the default catalogue page', async () => {
  websiteApi.layout.mockResolvedValue({ mode: 'PLATFORM', externalUrl: null, nav: [], hasHomePage: false, template: 'classic', footer: {} });
  site('/');
  expect(await screen.findByText('default catalogue page')).toBeInTheDocument();
  expect(websiteApi.publicPage).not.toHaveBeenCalled();
});
