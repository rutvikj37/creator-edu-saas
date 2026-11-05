import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { VideosPage } from './VideosPage.jsx';
import { ProviderEmbed } from '../../components/video/VideoPlayer.jsx';
import { videosApi } from '../../services/api/videos.js';
import { startTusUpload } from '../../services/api/tusUpload.js';

vi.mock('../../services/api/videos.js', () => ({
  videosApi: { config: vi.fn(), library: vi.fn(), details: vi.fn(), status: vi.fn(), edit: vi.fn(), destroy: vi.fn(), retryProcessing: vi.fn(), initiate: vi.fn(), complete: vi.fn(), preview: vi.fn(), create: vi.fn() },
  uploadVideo: vi.fn(), readVideoDuration: vi.fn(async () => 10),
}));
vi.mock('../../services/api/tusUpload.js', () => ({ startTusUpload: vi.fn() }));
vi.mock('../../services/api/creator.js', () => ({ coursesApi: { list: vi.fn(async () => ({ items: [{ id: 'c1', title: 'Course One' }] })), curriculum: vi.fn(async () => []) } }));

const config = { provider: 'BUNNY', maxUploadBytes: 20 * 1024 ** 3, mimeTypes: ['video/mp4', 'video/quicktime'], extensions: ['mp4', 'm4v', 'mov'] };
const wrap = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
const mp4 = (name = 'intro.mp4', size = 1000) => new File([new Uint8Array(size)], name, { type: 'video/mp4' });
const auth = { protocol: 'tus', endpoint: 'https://video.bunnycdn.com/tusupload', headers: { VideoId: 'g1' }, metadata: { title: 'intro' } };

beforeEach(() => {
  vi.clearAllMocks();
  videosApi.config.mockResolvedValue(config);
  videosApi.library.mockResolvedValue([]);
  videosApi.complete.mockResolvedValue({ status: 'UPLOADED' });
});

it('rejects unsupported files before contacting the server', async () => {
  wrap(<VideosPage />);
  await screen.findByText(/MP4, M4V, MOV/);
  fireEvent.change(screen.getByTestId('video-file-input'), { target: { files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' })] } });
  expect(await screen.findByText(/Unsupported format/)).toBeInTheDocument();
  expect(videosApi.initiate).not.toHaveBeenCalled();
});

it('uploads straight to Bunny with the server-issued credentials and reports the outcome', async () => {
  videosApi.initiate.mockResolvedValue({ videoId: 'v1', uploadSessionId: 's1', upload: auth });
  let finish;
  startTusUpload.mockImplementation((file, a, cb) => { cb.onStart(); cb.onProgress(40); return { promise: new Promise((r) => { finish = r; }), abort: vi.fn() }; });
  wrap(<VideosPage />);
  await screen.findByText(/MP4, M4V, MOV/);
  fireEvent.change(screen.getByTestId('video-file-input'), { target: { files: [mp4()] } });
  await waitFor(() => expect(videosApi.initiate).toHaveBeenCalledWith({ title: 'intro', filename: 'intro.mp4', size: 1000, mimeType: 'video/mp4', courseId: undefined, videoId: undefined }));
  expect(startTusUpload.mock.calls[0][1]).toBe(auth);
  expect(await screen.findByRole('progressbar', { name: /intro.mp4/ })).toHaveAttribute('aria-valuenow', '40');
  expect(videosApi.complete).toHaveBeenCalledWith({ videoId: 'v1', uploadSessionId: 's1', outcome: 'started' });
  await act(async () => finish());
  await waitFor(() => expect(videosApi.complete).toHaveBeenCalledWith({ videoId: 'v1', uploadSessionId: 's1', outcome: 'success' }));
  expect((await screen.findAllByText(/· Processing/))[0]).toBeInTheDocument();
});

it('cancel aborts the transfer; retry re-authorises the same video', async () => {
  videosApi.initiate.mockResolvedValue({ videoId: 'v1', uploadSessionId: 's1', upload: auth });
  const abort = vi.fn();
  startTusUpload.mockImplementation(() => ({ promise: new Promise(() => {}), abort }));
  wrap(<VideosPage />);
  await screen.findByText(/MP4, M4V, MOV/);
  fireEvent.change(screen.getByTestId('video-file-input'), { target: { files: [mp4()] } });
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  expect(abort).toHaveBeenCalled();
  expect(videosApi.complete).toHaveBeenCalledWith({ videoId: 'v1', uploadSessionId: 's1', outcome: 'cancelled' });
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(videosApi.initiate).toHaveBeenLastCalledWith(expect.objectContaining({ videoId: 'v1' })));
});

it('library shows processing and backup status and opens details', async () => {
  videosApi.library.mockResolvedValue([
    { id: 'v1', title: 'Intro', provider: 'BUNNY', status: 'READY', durationSeconds: 125, originalSize: 52428800, originalFilename: 'intro.mp4', createdAt: '2026-11-05T10:00:00Z', backup: { status: 'COMPLETED' }, course: { id: 'c1', title: 'Course One' } },
    { id: 'v2', title: 'Second', provider: 'BUNNY', status: 'PROCESSING', encodeProgress: 42, originalSize: 1000, createdAt: '2026-11-05T10:00:00Z', backup: { status: 'FAILED', errorMessage: 'quota' } },
  ]);
  videosApi.details.mockResolvedValue({ id: 'v1', title: 'Intro', provider: 'BUNNY', providerVideoId: 'g1', status: 'READY', width: 1920, height: 1080, availableResolutions: ['720p', '1080p'], durationSeconds: 125, originalSize: 52428800, createdAt: '2026-11-05T10:00:00Z', history: [], usedIn: [], backup: { status: 'COMPLETED' } });
  wrap(<VideosPage />);
  expect((await screen.findAllByText('Backed up'))[0]).toBeInTheDocument();
  expect(screen.getAllByText('Backup failed')[0]).toBeInTheDocument();
  expect(screen.getAllByText('42%')[0]).toBeInTheDocument();
  expect(screen.getAllByText('2:05')[0]).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: 'Actions for Intro' })[0]);
  await userEvent.click(screen.getByText('View details'));
  expect(await screen.findByText('g1')).toBeInTheDocument();
  expect(screen.getByText('1920×1080')).toBeInTheDocument();
});

it('player embed accepts progress only from the Bunny origin and resumes', async () => {
  const onTime = vi.fn();
  const onState = vi.fn();
  render(<ProviderEmbed url="https://iframe.mediadelivery.net/embed/1/g1?token=t&expires=9" resumeAt={42} onTime={onTime} onState={onState} />);
  const frame = screen.getByTestId('lesson-video-embed');
  const post = vi.spyOn(frame.contentWindow, 'postMessage');
  const msg = (data, origin = 'https://iframe.mediadelivery.net') => window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ context: 'player.js', ...data }), origin, source: frame.contentWindow }));
  act(() => msg({ event: 'ready' }));
  expect(post.mock.calls.map((c) => JSON.parse(c[0]).method)).toContain('setCurrentTime');
  expect(post.mock.calls.every((c) => c[1] === 'https://iframe.mediadelivery.net')).toBe(true);
  act(() => msg({ event: 'timeupdate', value: { seconds: 61, duration: 125 } }));
  act(() => msg({ event: 'timeupdate', value: { seconds: 999 } }, 'https://evil.example'));
  act(() => msg({ event: 'play' }));
  expect(onTime).toHaveBeenCalledTimes(1);
  expect(onTime).toHaveBeenCalledWith(61, 125);
  expect(onState).toHaveBeenCalledWith('play');
});
