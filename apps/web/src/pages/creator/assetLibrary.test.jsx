import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { VideosPage, assetType } from './VideosPage.jsx';
import { videosApi } from '../../services/api/videos.js';

vi.mock('../../services/api/videos.js', () => ({
  videosApi: { config: vi.fn(async () => ({ provider: 'BUNNY', maxUploadBytes: 1e9, mimeTypes: ['video/mp4'], extensions: ['mp4'] })), library: vi.fn(), details: vi.fn(), edit: vi.fn(), destroy: vi.fn(), preview: vi.fn() },
  uploadVideo: vi.fn(), readVideoDuration: vi.fn(async () => 10),
}));
vi.mock('../../services/api/tusUpload.js', () => ({ startTusUpload: vi.fn() }));
vi.mock('../../services/api/creator.js', () => ({ coursesApi: { list: vi.fn(async () => ({ items: [] })), curriculum: vi.fn(async () => []) } }));

const base = { status: 'READY', createdAt: '2026-11-20T10:00:00Z', updatedAt: '2026-11-20T10:00:00Z', usedIn: [], tags: [] };
const LIB = [
  { ...base, id: 'v'.repeat(25), title: 'Intro lecture', mimeType: 'video/mp4', tags: ['module 1'] },
  { ...base, id: 'a'.repeat(25), title: 'Podcast episode', mimeType: 'audio/mpeg' },
  { ...base, id: 'r'.repeat(25), title: 'Astrology replay', mimeType: 'video/mp4', liveRecording: { liveClassId: 'w1', title: 'Astrology basics', kind: 'WEBINAR' } },
];
const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><VideosPage /></MemoryRouter></QueryClientProvider>);
const visible = () => [...new Set(screen.queryAllByText(/Intro lecture|Podcast episode|Astrology replay/).map((e) => e.textContent))].sort();
const pick = async (chip, option) => { await userEvent.click(screen.getByRole('button', { name: chip })); await userEvent.click(await screen.findByRole('menuitem', { name: option })); };

afterEach(() => vi.clearAllMocks());

it('assetType tells video, audio and live recordings apart', () => {
  expect(LIB.map(assetType)).toEqual(['VIDEO', 'AUDIO', 'LIVE']);
});

it('filters the library by asset type, webinar, tag and asset ID', async () => {
  videosApi.library.mockResolvedValue(LIB);
  wrap();
  await waitFor(() => expect(visible()).toEqual(['Astrology replay', 'Intro lecture', 'Podcast episode']));
  await pick('Asset type', 'Audio');
  expect(visible()).toEqual(['Podcast episode']);
  await userEvent.click(screen.getByRole('button', { name: /^Reset/ }));
  await pick('Webinar', 'Astrology basics');
  expect(visible()).toEqual(['Astrology replay']);
  await userEvent.click(screen.getByRole('button', { name: /^Reset/ }));
  await pick('Tags', 'module 1');
  expect(visible()).toEqual(['Intro lecture']);
  await userEvent.click(screen.getByRole('button', { name: /^Reset/ }));
  await userEvent.type(screen.getByPlaceholderText('Search by title or asset ID'), 'a'.repeat(25));
  await waitFor(() => expect(visible()).toEqual(['Podcast episode']));
});

it('edits tags from the actions menu', async () => {
  videosApi.library.mockResolvedValue(LIB);
  videosApi.edit.mockResolvedValue({});
  wrap();
  await userEvent.click((await screen.findAllByRole('button', { name: 'Actions for Intro lecture' }))[0]);
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit details' }));
  const dialog = await screen.findByRole('dialog');
  const tags = within(dialog).getByLabelText('Tags');
  await userEvent.clear(tags);
  await userEvent.type(tags, 'Module 1, Intro');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(videosApi.edit).toHaveBeenCalledWith('v'.repeat(25), { title: 'Intro lecture', tags: ['module 1', 'intro'] }));
});

