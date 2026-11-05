import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { AppConfig } from '../../../../config/app-config.service.js';
import type { PlaybackAuthorization, ProviderStatistics, ProviderUsage, ProviderVideo, ProviderVideoState, UploadAuthorization, VideoProvider } from '../video-provider.interface.js';
import { BunnyApiError, BunnyClient, type BunnyVideo } from './bunny.client.js';

/**
 * Bunny video status codes, from Bunny's official SDKs (`@bunny.net/stream-import` BunnyVideoStatus,
 * `@bunny.net/stream-react-native` VideoStatusEnum): 4 = Finished (playable); libraries with JIT
 * encoding settle on 8 (JitPlaylistsCreated) instead.
 */
export const BUNNY_STATUS = { CREATED: 0, UPLOADED: 1, PROCESSING: 2, TRANSCODING: 3, FINISHED: 4, ERROR: 5, UPLOAD_FAILED: 6, JIT_SEGMENTING: 7, JIT_PLAYLISTS_CREATED: 8 } as const;

export function mapBunnyStatus(status: number): ProviderVideoState {
  switch (status) {
    case BUNNY_STATUS.CREATED: return 'CREATED';
    case BUNNY_STATUS.UPLOADED: return 'UPLOADED';
    case BUNNY_STATUS.PROCESSING:
    case BUNNY_STATUS.TRANSCODING:
    case BUNNY_STATUS.JIT_SEGMENTING: return 'PROCESSING';
    case BUNNY_STATUS.FINISHED:
    case BUNNY_STATUS.JIT_PLAYLISTS_CREATED: return 'READY';
    case BUNNY_STATUS.ERROR:
    case BUNNY_STATUS.UPLOAD_FAILED: return 'FAILED';
    default: return 'PROCESSING'; // unknown future code: keep waiting, a later read decides
  }
}

const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * Player embed token: SHA-256 hex of (token authentication key + video id + expiry unix seconds).
 * Source: Bunny's official iOS SDK (`generateEmbedToken` in @bunny.net/stream-react-native) and the
 * `token`/`expires` parameters of the official play-data API (Video_GetVideoPlayData).
 */
export function embedToken(tokenAuthKey: string, videoId: string, expires: number) {
  return sha256hex(tokenAuthKey + videoId + String(expires));
}

/**
 * Presigned TUS upload signature: SHA-256 hex of (library id + API key + expiry unix seconds + video id),
 * sent as AuthorizationSignature with AuthorizationExpire, VideoId and LibraryId.
 * Source: Bunny docs "TUS resumable uploads". NOTE: those docs could not be fetched from the build
 * environment, so this formula is recorded as "verify before production" in
 * docs/video-management/implementation-progress.md. It is isolated here so a correction is one line.
 */
export function tusSignature(libraryId: number, apiKey: string, expires: number, videoId: string) {
  return sha256hex(`${libraryId}${apiKey}${expires}${videoId}`);
}

@Injectable()
export class BunnyStreamProvider implements VideoProvider {
  readonly key = 'BUNNY' as const;
  private client: BunnyClient | null = null;

  constructor(private readonly config: AppConfig) {}

  isConfigured() {
    return Boolean(this.config.get('BUNNY_STREAM_API_KEY') && this.config.get('BUNNY_STREAM_LIBRARY_ID'));
  }

  get libraryId() {
    return Number(this.config.get('BUNNY_STREAM_LIBRARY_ID'));
  }

  /** Lazily built so tests can swap fetch via `useFetch`. */
  api(): BunnyClient {
    if (!this.isConfigured()) throw new BunnyApiError('Bunny Stream is not configured', 0, false);
    this.client ??= new BunnyClient({
      apiKey: this.config.get('BUNNY_STREAM_API_KEY')!,
      libraryId: this.libraryId,
      streamBaseUrl: this.config.get('BUNNY_STREAM_API_BASE_URL'),
      coreBaseUrl: this.config.get('BUNNY_CORE_API_BASE_URL'),
      accountApiKey: this.config.get('BUNNY_ACCOUNT_API_KEY') || undefined,
    });
    return this.client;
  }

  /** Test seam: route provider HTTP through a stand-in. */
  useClient(client: BunnyClient | null) {
    this.client = client;
  }

  async createGroup(name: string) {
    const c = await this.api().createCollection(name.slice(0, 100));
    if (!c?.guid) throw new BunnyApiError('Bunny did not return a collection id', 502, true);
    return c.guid;
  }

  async createVideo(input: { title: string; groupId?: string | null }) {
    const v = await this.api().createVideo({ title: input.title, collectionId: input.groupId ?? null });
    if (!v?.guid) throw new BunnyApiError('Bunny did not return a video id', 502, true);
    return { providerVideoId: v.guid };
  }

  authorizeUpload(providerVideoId: string, ttlSeconds: number, meta: { title: string; mimeType: string }): UploadAuthorization {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    return {
      protocol: 'tus',
      endpoint: this.config.get('BUNNY_STREAM_TUS_ENDPOINT'),
      headers: {
        AuthorizationSignature: tusSignature(this.libraryId, this.config.get('BUNNY_STREAM_API_KEY')!, expires, providerVideoId),
        AuthorizationExpire: String(expires),
        VideoId: providerVideoId,
        LibraryId: String(this.libraryId),
      },
      metadata: { filetype: meta.mimeType, title: meta.title },
      expiresAt: new Date(expires * 1000),
    };
  }

  toProviderVideo(v: BunnyVideo): ProviderVideo {
    return {
      providerVideoId: v.guid,
      state: mapBunnyStatus(v.status),
      rawStatus: v.status,
      title: v.title,
      durationSeconds: v.length > 0 ? v.length : null,
      width: v.width > 0 ? v.width : null,
      height: v.height > 0 ? v.height : null,
      availableResolutions: (v.availableResolutions ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      thumbnailUrl: v.thumbnailUrl ?? (v.thumbnailFileName && this.config.get('BUNNY_STREAM_CDN_HOSTNAME') ? `https://${this.config.get('BUNNY_STREAM_CDN_HOSTNAME')}/${v.guid}/${v.thumbnailFileName}` : null),
      storageBytes: Number.isFinite(v.storageSize) ? v.storageSize : null,
      encodeProgress: Number.isFinite(v.encodeProgress) ? v.encodeProgress : null,
      hasOriginal: Boolean(v.hasOriginal),
      originalHash: v.originalHash ?? null,
    };
  }

  async getVideo(providerVideoId: string) {
    return this.toProviderVideo(await this.api().getVideo(providerVideoId));
  }

  deleteVideo(providerVideoId: string) {
    return this.api().deleteVideo(providerVideoId);
  }

  async reprocess(providerVideoId: string) {
    await this.api().reencode(providerVideoId);
  }

  tokenFor(providerVideoId: string, ttlSeconds: number) {
    const key = this.config.get('BUNNY_STREAM_TOKEN_AUTH_KEY');
    if (!key) throw new BunnyApiError('BUNNY_STREAM_TOKEN_AUTH_KEY is not set; protected playback is unavailable', 0, false);
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    return { token: embedToken(key, providerVideoId, expires), expires };
  }

  authorizePlayback(providerVideoId: string, ttlSeconds: number): PlaybackAuthorization {
    const { token, expires } = this.tokenFor(providerVideoId, ttlSeconds);
    const base = this.config.get('BUNNY_STREAM_EMBED_BASE_URL').replace(/\/$/, '');
    const url = new URL(`${base}/embed/${this.libraryId}/${encodeURIComponent(providerVideoId)}`);
    url.searchParams.set('token', token);
    url.searchParams.set('expires', String(expires));
    url.searchParams.set('autoplay', 'false');
    url.searchParams.set('preload', 'true');
    url.searchParams.set('responsive', 'true');
    return { kind: 'iframe', url: url.toString(), expiresAt: new Date(expires * 1000), protection: 'token' };
  }

  /** Uses `originalUrl` from the official play-data API; requires "Keep original files" on the library. */
  async downloadOriginal(providerVideoId: string): Promise<{ stream: Readable; size: number | null } | null> {
    const token = this.config.get('BUNNY_STREAM_TOKEN_AUTH_KEY') ? this.tokenFor(providerVideoId, 3600) : undefined;
    const play = await this.api().playData(providerVideoId, token);
    if (!play?.originalUrl) return null;
    return this.api().download(play.originalUrl);
  }

  uploadFile(providerVideoId: string, body: Readable, size: number) {
    return this.api().uploadVideo(providerVideoId, body, size);
  }

  async libraryUsage(): Promise<ProviderUsage | null> {
    const lib = await this.api().library();
    if (!lib) return null;
    return { storageBytes: Number(lib.StorageUsage ?? 0), trafficBytes: Number(lib.TrafficUsage ?? 0) };
  }

  async statistics(range: { from: Date; to: Date; providerVideoId?: string }): Promise<ProviderStatistics> {
    const s = await this.api().statistics({ dateFrom: range.from.toISOString(), dateTo: range.to.toISOString(), videoGuid: range.providerVideoId });
    const sum = (o?: Record<string, number> | null) => Object.values(o ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);
    return { views: sum(s?.viewsChart), watchSeconds: sum(s?.watchTimeChart) };
  }
}
