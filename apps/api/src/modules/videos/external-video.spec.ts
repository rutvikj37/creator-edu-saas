import { parseExternalVideoUrl } from './external-video.js';

describe('parseExternalVideoUrl', () => {
  it('parses common YouTube URL shapes', () => {
    for (const raw of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'http://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30',
    ]) {
      const p = parseExternalVideoUrl(raw);
      expect(p).toMatchObject({
        provider: 'YOUTUBE',
        providerAssetId: 'dQw4w9WgXcQ',
        externalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      });
      expect(p!.thumbnailUrl).toContain('dQw4w9WgXcQ');
    }
  });

  it('parses Google Drive file links', () => {
    const id = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
    for (const raw of [
      `https://drive.google.com/file/d/${id}/view?usp=sharing`,
      `https://drive.google.com/open?id=${id}`,
      `https://docs.google.com/file/d/${id}/edit`,
    ]) {
      const p = parseExternalVideoUrl(raw);
      expect(p).toMatchObject({
        provider: 'GOOGLE_DRIVE',
        providerAssetId: id,
        externalUrl: `https://drive.google.com/file/d/${id}/view`,
        embedUrl: `https://drive.google.com/file/d/${id}/preview`,
      });
      expect(p!.thumbnailUrl).toContain(id);
    }
  });

  it('rejects unsupported hosts and junk', () => {
    expect(parseExternalVideoUrl('https://vimeo.com/123')).toBeNull();
    expect(parseExternalVideoUrl('not a url')).toBeNull();
    expect(parseExternalVideoUrl('https://youtube.com/watch')).toBeNull();
  });
});
