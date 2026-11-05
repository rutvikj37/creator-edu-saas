import { act, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { videosApi } from '../../services/api/videos.js';
import { VideoPlayer } from './VideoPlayer.jsx';

vi.mock('../../services/api/videos.js', () => ({
  videosApi: { start: vi.fn(), heartbeat: vi.fn(), end: vi.fn() },
}));

afterEach(() => vi.clearAllMocks());

describe('VideoPlayer', () => {
  it('starts a session, plays the signed URL and ends the session on unmount', async () => {
    videosApi.start.mockResolvedValue({ sessionId: 's1', url: '/api/v1/files/local/tok', resumeAt: 0 });
    videosApi.heartbeat.mockResolvedValue({ completed: false });
    videosApi.end.mockResolvedValue({});
    const { unmount } = render(<VideoPlayer lessonId="l1" />);
    const video = await screen.findByTestId('lesson-video');
    expect(videosApi.start).toHaveBeenCalledWith('l1');
    expect(video).toHaveAttribute('src', '/api/v1/files/local/tok');
    expect(video).toHaveAttribute('controlsList', 'nodownload');
    unmount();
    await waitFor(() => expect(videosApi.end).toHaveBeenCalledWith('s1'));
    expect(videosApi.heartbeat).toHaveBeenCalledWith('s1', expect.objectContaining({ positionSeconds: 0 }));
  });

  it('reports completion from a heartbeat', async () => {
    videosApi.start.mockResolvedValue({ sessionId: 's2', url: '/v.mp4' });
    videosApi.heartbeat.mockResolvedValue({ completed: true });
    const onCompleted = vi.fn();
    render(<VideoPlayer lessonId="l2" onCompleted={onCompleted} />);
    const video = await screen.findByTestId('lesson-video');
    await act(async () => video.dispatchEvent(new Event('pause')));
    expect(onCompleted).toHaveBeenCalledOnce();
  });

  it('stops playback when the server revokes the session', async () => {
    videosApi.start.mockResolvedValue({ sessionId: 's3', url: '/v.mp4' });
    videosApi.heartbeat.mockRejectedValue(Object.assign(new Error('Your access to this course has ended'), { status: 403 }));
    render(<VideoPlayer lessonId="l3" />);
    const video = await screen.findByTestId('lesson-video');
    video.pause = vi.fn();
    await act(async () => video.dispatchEvent(new Event('pause')));
    expect(await screen.findByText('Your access to this course has ended')).toBeInTheDocument();
    expect(screen.queryByTestId('lesson-video')).not.toBeInTheDocument();
  });

  it('shows the start error (e.g. device limit)', async () => {
    videosApi.start.mockRejectedValue(Object.assign(new Error('Too many devices are playing'), { status: 429 }));
    render(<VideoPlayer lessonId="l4" />);
    expect(await screen.findByText('Too many devices are playing')).toBeInTheDocument();
  });
});
