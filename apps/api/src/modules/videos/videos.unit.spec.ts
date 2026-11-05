import { createHash } from 'node:crypto';
import { BunnyApiError, BunnyClient, backoff } from './providers/bunny/bunny.client.js';
import { embedToken, mapBunnyStatus, tusSignature } from './providers/bunny/bunny.service.js';
import { sanitizeFilename } from './services/video-upload.service.js';
import { canTransition } from './videos.repository.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('Bunny status mapping (official status codes)', () => {
  it('maps every documented code', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(mapBunnyStatus)).toEqual(['CREATED', 'UPLOADED', 'PROCESSING', 'PROCESSING', 'READY', 'FAILED', 'FAILED', 'PROCESSING', 'READY']);
    expect(mapBunnyStatus(99)).toBe('PROCESSING');
  });
});

describe('signatures', () => {
  it('embed token = sha256(key + videoId + expires)', () => {
    expect(embedToken('k', 'vid', 1700000000)).toBe(sha('kvid1700000000'));
  });
  it('TUS signature = sha256(libraryId + apiKey + expires + videoId)', () => {
    expect(tusSignature(42, 'api', 1700000000, 'vid')).toBe(sha('42api1700000000vid'));
  });
});

describe('sanitizeFilename', () => {
  it('drops paths and unsafe characters, keeps letters in any script', () => {
    expect(sanitizeFilename('C:\\\\Users\\\\me\\\\Desktop\\\\class.mp4')).toBe('class.mp4');
    expect(sanitizeFilename('../../etc/pa<ss>wd\u0007.mp4')).toBe('pa_ss_wd.mp4');
    expect(sanitizeFilename('पाठ १ – परिचय.mp4')).toBe('पाठ १ – परिचय.mp4');
    expect(sanitizeFilename('...')).toBe('video');
  });
});

describe('status transitions', () => {
  it('allows the pipeline and forbids going backwards from terminal states', () => {
    expect(canTransition('UPLOAD_AUTHORIZED', 'READY')).toBe(true);
    expect(canTransition('FAILED', 'UPLOAD_AUTHORIZED')).toBe(true);
    expect(canTransition('READY', 'UPLOAD_AUTHORIZED')).toBe(false);
    expect(canTransition('DELETED', 'READY')).toBe(false);
    expect(canTransition('DELETING', 'READY')).toBe(false);
  });
});

describe('BunnyClient', () => {
  const make = (responses: (Response | Error)[]) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const sleeps: number[] = [];
    const client = new BunnyClient({
      apiKey: 'lib-key', libraryId: 7, streamBaseUrl: 'https://video.example', coreBaseUrl: 'https://core.example', maxRetries: 3,
      fetchImpl: async (u, init) => { calls.push({ url: String(u), init: init ?? {} }); const r = responses.shift()!; if (r instanceof Error) throw r; return r; },
      sleep: async (ms) => { sleeps.push(ms); },
    });
    return { client, calls, sleeps };
  };
  const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

  it('sends the AccessKey header to the library path', async () => {
    const { client, calls } = make([ok({ guid: 'g', status: 4 })]);
    await client.getVideo('g');
    expect(calls[0].url).toBe('https://video.example/library/7/videos/g');
    expect(new Headers(calls[0].init.headers).get('AccessKey')).toBe('lib-key');
  });
  it('retries 429/5xx and network errors with backoff, honouring Retry-After', async () => {
    const { client, sleeps } = make([new Response(null, { status: 429, headers: { 'retry-after': '3' } }), new Response(null, { status: 502 }), Object.assign(new Error('socket'), { name: 'TypeError' }), ok({ guid: 'g' })]);
    expect(await client.getVideo('g')).toEqual({ guid: 'g' });
    expect(sleeps).toHaveLength(3);
    expect(sleeps[0]).toBeGreaterThanOrEqual(3000);
  });
  it('does not retry client errors or non-idempotent creates, and reads Bunny error messages', async () => {
    const { client, calls } = make([new Response(JSON.stringify({ Message: 'Invalid title' }), { status: 400 })]);
    await expect(client.createVideo({ title: '' })).rejects.toMatchObject({ status: 400, retryable: false, message: 'Bunny Stream 400: Invalid title' });
    expect(calls).toHaveLength(1);
    const c2 = make([new Response(null, { status: 503 })]);
    await expect(c2.client.createVideo({ title: 'x' })).rejects.toBeInstanceOf(BunnyApiError);
    expect(c2.calls).toHaveLength(1);
  });
  it('gives up after max retries and treats delete 404 as done', async () => {
    const { client } = make([new Response(null, { status: 500 }), new Response(null, { status: 500 }), new Response(null, { status: 500 }), new Response(null, { status: 500 })]);
    await expect(client.getVideo('g')).rejects.toMatchObject({ status: 500, retryable: true });
    const d = make([new Response(null, { status: 404 })]);
    await expect(d.client.deleteVideo('g')).resolves.toBeUndefined();
  });
  it('timeouts become retryable provider errors', async () => {
    const t = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const { client } = make([t, t, t, t]);
    await expect(client.getVideo('g')).rejects.toMatchObject({ message: 'Bunny Stream did not respond in time', retryable: true });
  });
  it('backoff grows and is capped', () => {
    expect(backoff(0, null)).toBeLessThan(1000);
    expect(backoff(10, null)).toBe(30_000);
    expect(backoff(0, '120')).toBe(30_000);
  });
});
