import { Readable } from 'node:stream';
import type { components as StreamSchemas } from '@bunny.net/openapi-client/stream';
import type { components as CoreSchemas } from '@bunny.net/openapi-client/core';

/**
 * Minimal HTTP client for the Bunny Stream API.
 *
 * Endpoint paths, the `AccessKey` header, and every request/response shape below are checked at
 * compile time against Bunny's official OpenAPI types (`@bunny.net/openapi-client`). This client is
 * written by hand (rather than using the generated one) for timeouts, retries with backoff on
 * 429/5xx/network errors, and streamed upload/download bodies.
 */
export type BunnyVideo = StreamSchemas['schemas']['VideoModel'];
export type BunnyCollection = StreamSchemas['schemas']['CollectionModel'];
export type BunnyCreateVideo = StreamSchemas['schemas']['CreateVideoModel'];
export type BunnyPlayData = StreamSchemas['schemas']['VideoPlayDataModel'];
export type BunnyStatistics = StreamSchemas['schemas']['VideoStatisticsModel'];
export type BunnyLibrary = CoreSchemas['schemas']['VideoLibraryModel'];

export class BunnyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'BunnyApiError';
  }
}

export interface BunnyClientOptions {
  apiKey: string;
  libraryId: number;
  streamBaseUrl: string;
  coreBaseUrl: string;
  accountApiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

type Json = Record<string, unknown> | unknown[];

export class BunnyClient {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly o: BunnyClientOptions) {
    this.fetch = o.fetchImpl ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private lib(path: string) {
    return `${this.o.streamBaseUrl.replace(/\/$/, '')}/library/${this.o.libraryId}${path}`;
  }

  /** JSON request with timeout and bounded retries (idempotent methods, or POSTs we mark safe). */
  private async request<T>(method: string, url: string, init: { body?: Json; key?: string; retry?: boolean; query?: Record<string, string | number | boolean | undefined> } = {}): Promise<T> {
    const u = new URL(url);
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    const retries = init.retry === false ? 0 : (this.o.maxRetries ?? 3);
    let last: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await this.fetch(u, {
          method,
          headers: { AccessKey: init.key ?? this.o.apiKey, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
          body: init.body ? JSON.stringify(init.body) : undefined,
          signal: AbortSignal.timeout(this.o.timeoutMs ?? 20_000),
        });
        if (res.ok) {
          const text = await res.text();
          return (text ? JSON.parse(text) : null) as T;
        }
        const retryable = res.status === 429 || res.status >= 500;
        const message = await errorMessage(res);
        last = new BunnyApiError(message, res.status, retryable);
        if (!retryable || attempt === retries) throw last;
        await this.sleep(backoff(attempt, res.headers.get('retry-after')));
      } catch (e) {
        if (e instanceof BunnyApiError) throw e;
        // Network error or timeout.
        last = new BunnyApiError(e instanceof Error && e.name === 'TimeoutError' ? 'Bunny Stream did not respond in time' : 'Could not reach Bunny Stream', 0, true);
        if (attempt === retries) throw last;
        await this.sleep(backoff(attempt, null));
      }
    }
    throw last;
  }

  createCollection(name: string) {
    return this.request<BunnyCollection>('POST', this.lib('/collections'), { body: { name } satisfies StreamSchemas['schemas']['UpdateCollectionModel'], retry: false });
  }

  createVideo(body: BunnyCreateVideo) {
    return this.request<BunnyVideo>('POST', this.lib('/videos'), { body, retry: false });
  }

  getVideo(videoId: string) {
    return this.request<BunnyVideo>('GET', this.lib(`/videos/${encodeURIComponent(videoId)}`));
  }

  async deleteVideo(videoId: string) {
    try {
      await this.request<unknown>('DELETE', this.lib(`/videos/${encodeURIComponent(videoId)}`));
    } catch (e) {
      if (e instanceof BunnyApiError && e.status === 404) return; // already gone
      throw e;
    }
  }

  reencode(videoId: string) {
    return this.request<BunnyVideo>('POST', this.lib(`/videos/${encodeURIComponent(videoId)}/reencode`), { retry: false });
  }

  playData(videoId: string, token?: { token: string; expires: number }) {
    return this.request<BunnyPlayData>('GET', this.lib(`/videos/${encodeURIComponent(videoId)}/play`), { query: token ? { token: token.token, expires: token.expires } : {} });
  }

  statistics(q: { dateFrom?: string; dateTo?: string; videoGuid?: string }) {
    return this.request<BunnyStatistics>('GET', this.lib('/statistics'), { query: q });
  }

  /** Core API; needs the account API key. */
  library() {
    if (!this.o.accountApiKey) return Promise.resolve(null);
    return this.request<BunnyLibrary>('GET', `${this.o.coreBaseUrl.replace(/\/$/, '')}/videolibrary/${this.o.libraryId}`, { key: this.o.accountApiKey });
  }

  /** Server-side upload (Video_UploadVideo): streamed body, no retries (the body is consumed). */
  async uploadVideo(videoId: string, body: Readable, size: number) {
    const res = await this.fetch(this.lib(`/videos/${encodeURIComponent(videoId)}`), {
      method: 'PUT',
      headers: { AccessKey: this.o.apiKey, 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) },
      body: Readable.toWeb(body) as unknown as BodyInit,
      // Node's fetch requires half-duplex for streamed request bodies.
      duplex: 'half',
    } as RequestInit);
    if (!res.ok) throw new BunnyApiError(await errorMessage(res), res.status, res.status === 429 || res.status >= 500);
  }

  /** Streams a URL Bunny handed us (e.g. originalUrl). */
  async download(url: string) {
    const res = await this.fetch(url, { headers: { AccessKey: this.o.apiKey } });
    if (!res.ok || !res.body) throw new BunnyApiError(`Original download failed (${res.status})`, res.status, res.status === 429 || res.status >= 500);
    const len = res.headers.get('content-length');
    return { stream: Readable.fromWeb(res.body as never), size: len ? Number(len) : null };
  }
}

async function errorMessage(res: Response) {
  try {
    const body = (await res.json()) as { Message?: string; message?: string };
    return `Bunny Stream ${res.status}: ${body.Message ?? body.message ?? res.statusText}`;
  } catch {
    return `Bunny Stream ${res.status}: ${res.statusText || 'request failed'}`;
  }
}

/** Exponential backoff with jitter; honours Retry-After seconds when present (capped at 30 s). */
export function backoff(attempt: number, retryAfter: string | null) {
  const ra = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : 0;
  return Math.min(30_000, Math.max(ra, 500 * 2 ** attempt + Math.floor(Math.random() * 250)));
}
