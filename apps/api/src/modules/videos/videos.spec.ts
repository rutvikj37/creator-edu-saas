import { playbackTtlSeconds } from './videos.service.js';

describe('playbackTtlSeconds', () => {
  it('covers the whole video with a margin, capped at 6 hours', () => {
    expect(playbackTtlSeconds(null)).toBe(1800);
    expect(playbackTtlSeconds(3600)).toBe(3600 * 2 + 1800);
    expect(playbackTtlSeconds(20 * 3600)).toBe(6 * 3600);
  });
});
