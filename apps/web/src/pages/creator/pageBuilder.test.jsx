import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { PageBuilderPage } from './PageBuilderPage.jsx';
import { websiteApi } from '../../services/api/website.js';

vi.mock('../../services/api/website.js', () => ({ websiteApi: { page: vi.fn(), savePage: vi.fn(), publish: vi.fn(), unpublish: vi.fn(), versions: vi.fn(async () => []), restore: vi.fn(), previewToken: vi.fn() } }));
vi.mock('../../services/api/auth.js', () => ({ workspaceApi: { workspace: vi.fn(async () => ({ primaryHostname: 'meera.lvh.me' })) } }));
vi.mock('../../services/api/creator.js', () => ({ academyApi2: { get: vi.fn(async () => ({ primaryColor: '#0f766e' })) }, coursesApi: { list: vi.fn(async () => ({ items: [{ id: 'c1', slug: 'mf', title: 'Mutual Funds 101', status: 'PUBLISHED', isFree: true }] })) } }));
vi.mock('../public/AcademyLandingPage.jsx', () => ({ CourseCard: ({ c }) => <div>{c.title}</div> }));
vi.mock('../../components/forms/RichTextEditor.jsx', () => ({ RichTextEditor: () => <div>editor</div> }));
vi.mock('../../components/forms/RichTextView.jsx', () => ({ RichTextView: () => <div>rich text</div> }));

const page = (blocks, over = {}) => ({ id: 'p1', title: 'About', slug: 'about', isHome: false, showInNav: true, seoTitle: null, seoDescription: null, draftBlocks: blocks, files: {}, publishedAt: null, hasUnpublishedChanges: true, ...over });
const hero = { id: 'b1', type: 'hero', hidden: false, props: { heading: 'About Meera', subheading: '', ctaLabel: '', ctaHref: '', imageFileId: null, align: 'center' } };

function renderBuilder() {
  const router = createMemoryRouter([{ path: '/creator/website/pages/:id', element: <PageBuilderPage /> }, { path: '/creator/website', element: <p>website page</p> }], { initialEntries: ['/creator/website/pages/p1'] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}
const canvas = () => screen.getByTestId('builder-canvas');

beforeEach(() => {
  vi.clearAllMocks();
  websiteApi.savePage.mockImplementation(async (id, body) => page(body.draftBlocks ?? [], { title: body.title ?? 'About' }));
});

it('adds blocks from the palette, edits them in the inspector, and undo/redo works', async () => {
  websiteApi.page.mockResolvedValue(page([hero]));
  renderBuilder();
  expect(await within(await screen.findByTestId('builder-canvas')).findByText('About Meera')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Add FAQ block' }));
  expect(within(canvas()).getByText('Frequently asked questions')).toBeInTheDocument();
  // New block is selected → inspector edits update the canvas.
  const heading = screen.getByDisplayValue('Frequently asked questions');
  await userEvent.clear(heading);
  await userEvent.type(heading, 'Common questions');
  expect(within(canvas()).getByText('Common questions')).toBeInTheDocument();
  // Typing is grouped; undo goes back to before the edit, then before the add.
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(within(canvas()).queryByText('Common questions')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(screen.queryByTestId('canvas-block-faq')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  expect(await screen.findByTestId('canvas-block-faq')).toBeInTheDocument();
});

it('duplicate, hide and delete blocks, then save the draft and publish', async () => {
  websiteApi.page.mockResolvedValue(page([hero]));
  websiteApi.publish.mockResolvedValue(page([hero], { publishedAt: '2026-11-05T10:00:00Z', hasUnpublishedChanges: false }));
  renderBuilder();
  await screen.findByTestId('canvas-block-hero');
  expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
  const block = screen.getByTestId('canvas-block-hero');
  await userEvent.click(within(block).getByRole('button', { name: 'Duplicate block' }));
  expect(screen.getAllByTestId('canvas-block-hero')).toHaveLength(2);
  await userEvent.click(within(screen.getAllByTestId('canvas-block-hero')[1]).getByRole('button', { name: 'Hide block' }));
  await userEvent.click(within(screen.getAllByTestId('canvas-block-hero')[0]).getByRole('button', { name: 'Delete block' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(websiteApi.savePage).toHaveBeenCalled());
  const saved = websiteApi.savePage.mock.calls[0][1];
  expect(saved.draftBlocks).toHaveLength(1);
  expect(saved.draftBlocks[0]).toMatchObject({ type: 'hero', hidden: true });
  expect(saved.draftBlocks[0].id).not.toBe('b1');
  expect(saved).toMatchObject({ title: 'About', slug: 'about', showInNav: true });
  await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
  await waitFor(() => expect(websiteApi.publish).toHaveBeenCalledWith('p1', null));
});

it('shows server validation on the right block and keeps the draft', async () => {
  websiteApi.page.mockResolvedValue(page([hero, { id: 'b2', type: 'cta', hidden: false, props: { heading: 'Go', text: '', buttonLabel: 'Start', buttonHref: 'javascript:alert(1)' } }]));
  websiteApi.savePage.mockRejectedValueOnce(Object.assign(new Error('Some fields are invalid'), { details: [{ field: 'blocks.1.props.buttonHref', message: 'Use a path like /courses or a full https:// link' }] }));
  renderBuilder();
  await screen.findByTestId('canvas-block-cta');
  await userEvent.click(within(screen.getByTestId('canvas-block-hero')).getByRole('button', { name: 'Hide block' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  expect(await screen.findByText('Use a path like /courses or a full https:// link')).toBeInTheDocument();
  expect(screen.getByDisplayValue('javascript:alert(1)')).toBeInTheDocument(); // inspector opened on the failing block
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
});

it('page settings: title, address and search engine fields are saved with the page', async () => {
  websiteApi.page.mockResolvedValue(page([hero]));
  renderBuilder();
  await screen.findByTestId('canvas-block-hero');
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await userEvent.clear(screen.getByLabelText('Title'));
  await userEvent.type(screen.getByLabelText('Title'), 'Our story');
  await userEvent.clear(screen.getByLabelText('Address'));
  await userEvent.type(screen.getByLabelText('Address'), 'Our Story');
  await userEvent.type(screen.getByLabelText('Search engine title'), 'Our story · Meera');
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(websiteApi.savePage.mock.calls[0][1]).toMatchObject({ title: 'Our story', slug: 'our-story', seoTitle: 'Our story · Meera' }));
});
