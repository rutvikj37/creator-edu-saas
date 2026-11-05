import { createHash } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { BunnyClient } from '../src/modules/videos/providers/bunny/bunny.client.js';
import { BunnyStreamProvider } from '../src/modules/videos/providers/bunny/bunny.service.js';

/**
 * In-memory Bunny Stream used by the e2e suite. It answers only the endpoints our client calls,
 * with the response shapes of Bunny's official OpenAPI types (VideoModel, CollectionModel,
 * VideoPlayDataModel, VideoStatisticsModel, VideoLibraryModel), and checks the AccessKey header.
 * The production BunnyClient/BunnyStreamProvider code runs unchanged on top of it. No network.
 */
export class BunnySim {
  readonly base = 'https://bunny.sim';
  readonly core = 'https://core.bunny.sim';
  videos = new Map<string, any>();
  originals = new Map<string, Buffer>();
  collections = new Map<string, string>();
  calls: string[] = [];
  failures: { match: RegExp; status: number; times: number }[] = [];
  library = { storage: 0, traffic: 0 };
  watch = new Map<string, number>();
  private n = 0;

  constructor(readonly apiKey: string, readonly libraryId: number, readonly accountKey: string) {}

  install(app: NestExpressApplication) {
    app.get(BunnyStreamProvider).useClient(new BunnyClient({
      apiKey: this.apiKey, libraryId: this.libraryId, streamBaseUrl: this.base, coreBaseUrl: this.core, accountApiKey: this.accountKey,
      fetchImpl: (input, init) => this.fetch(String(input instanceof URL ? input.toString() : input), init ?? {}), sleep: async () => {},
    }));
    return this;
  }

  /** Make the next `times` calls matching `match` fail with `status`. */
  fail(match: RegExp, status: number, times = 1) {
    this.failures.push({ match, status, times });
  }

  private guid() {
    const h = createHash('sha256').update(String(++this.n)).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  }

  video(over: Record<string, unknown> = {}) {
    return {
      videoLibraryId: this.libraryId, guid: this.guid(), title: 'Untitled', dateUploaded: new Date().toISOString(), views: 0, isPublic: false, length: 0, status: 0, framerate: 0,
      width: 0, height: 0, availableResolutions: null, outputCodecs: 'x264', thumbnailCount: 0, encodeProgress: 0, storageSize: 0, hasMP4Fallback: false, collectionId: null,
      thumbnailFileName: 'thumbnail.jpg', averageWatchTime: 0, totalWatchTime: 0, hasOriginal: false, originalHash: null, ...over,
    };
  }

  /** Simulates the browser's TUS upload finishing (Bunny then reports status 1 = Uploaded). */
  uploaded(guid: string, bytes: Buffer) {
    const v = this.videos.get(guid);
    this.originals.set(guid, bytes);
    Object.assign(v, { status: 1, hasOriginal: true, originalHash: createHash('sha256').update(bytes).digest('hex') });
  }

  finish(guid: string, over: Record<string, unknown> = {}) {
    Object.assign(this.videos.get(guid), { status: 4, length: 125, width: 1920, height: 1080, availableResolutions: '360p,720p,1080p', encodeProgress: 100, storageSize: 48_000_000, ...over });
  }

  setStatus(guid: string, status: number) {
    this.videos.get(guid).status = status;
  }

  private json(status: number, body: unknown) {
    return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  async fetch(url: string, init: RequestInit): Promise<Response> {
    const u = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    const key = new Headers(init.headers).get('AccessKey');
    this.calls.push(`${method} ${u.pathname}`);
    const f = this.failures.find((x) => x.times > 0 && x.match.test(`${method} ${u.pathname}`));
    if (f) {
      f.times--;
      return this.json(f.status, f.status === 400 ? { Message: 'Simulated error' } : null);
    }
    if (u.origin === this.core) {
      if (key !== this.accountKey) return this.json(401, null);
      if (method === 'GET' && u.pathname === `/videolibrary/${this.libraryId}`) return this.json(200, { Id: this.libraryId, Name: 'Test', VideoCount: this.videos.size, StorageUsage: this.library.storage, TrafficUsage: this.library.traffic });
      return this.json(404, null);
    }
    if (u.pathname.startsWith('/original/')) {
      const bytes = this.originals.get(u.pathname.slice('/original/'.length));
      return bytes ? new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-length': String(bytes.length) } }) : this.json(404, null);
    }
    if (key !== this.apiKey) return this.json(401, null);
    const lib = `/library/${this.libraryId}`;
    if (!u.pathname.startsWith(lib)) return this.json(404, null);
    const p = u.pathname.slice(lib.length);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    let m: RegExpMatchArray | null;
    if (method === 'POST' && p === '/collections') {
      const guid = this.guid();
      this.collections.set(guid, body.name);
      return this.json(200, { videoLibraryId: this.libraryId, guid, name: body.name, videoCount: 0, totalSize: 0 });
    }
    if (method === 'POST' && p === '/videos') {
      const v = this.video({ title: body.title, collectionId: body.collectionId ?? null });
      this.videos.set(v.guid, v);
      return this.json(200, v);
    }
    if (method === 'GET' && p === '/statistics') {
      const g = u.searchParams.get('videoGuid');
      const w = g ? (this.watch.get(g) ?? 0) : [...this.watch.values()].reduce((a, b) => a + b, 0);
      return this.json(200, { viewsChart: { '2026-11-01T00:00:00Z': w ? 1 : 0 }, watchTimeChart: { '2026-11-01T00:00:00Z': w } });
    }
    if ((m = p.match(/^\/videos\/([^/]+)\/play$/))) {
      const v = this.videos.get(m[1]);
      if (!v) return this.json(404, null);
      return this.json(200, { video: v, originalUrl: this.originals.has(v.guid) ? `${this.base}/original/${v.guid}` : null, tokenAuthEnabled: true, isPlayable: v.status === 4 });
    }
    if ((m = p.match(/^\/videos\/([^/]+)\/reencode$/))) {
      const v = this.videos.get(m[1]);
      if (!v) return this.json(404, null);
      v.status = 3;
      return this.json(200, v);
    }
    if ((m = p.match(/^\/videos\/([^/]+)$/))) {
      const v = this.videos.get(m[1]);
      if (!v) return this.json(404, null);
      if (method === 'GET') return this.json(200, v);
      if (method === 'DELETE') {
        this.videos.delete(m[1]);
        this.originals.delete(m[1]);
        return this.json(200, { success: true, message: 'OK', statusCode: 200 });
      }
      if (method === 'PUT') {
        const chunks: Buffer[] = [];
        const reader = (init.body as ReadableStream<Uint8Array>).getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
        }
        this.uploaded(m[1], Buffer.concat(chunks));
        return this.json(200, { success: true, message: 'OK', statusCode: 200 });
      }
    }
    return this.json(404, null);
  }
}

export function bunnySim(app: NestExpressApplication) {
  return new BunnySim(process.env.BUNNY_STREAM_API_KEY!, Number(process.env.BUNNY_STREAM_LIBRARY_ID), process.env.BUNNY_ACCOUNT_API_KEY!).install(app);
}
