import type { Readable } from 'node:stream';

/** Provider-neutral lifecycle of a hosted video. */
export type ProviderVideoState = 'CREATED' | 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';

export interface ProviderVideo {
  providerVideoId: string;
  state: ProviderVideoState;
  /** Raw provider status code (kept for diagnostics). */
  rawStatus: number;
  title: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  availableResolutions: string[];
  thumbnailUrl: string | null;
  storageBytes: number | null;
  encodeProgress: number | null;
  hasOriginal: boolean;
  /** Provider-computed hash of the original upload, if any (Bunny: SHA-256). */
  originalHash: string | null;
}

/** What the browser needs to upload straight to the provider. No long-lived secret is included. */
export interface UploadAuthorization {
  protocol: 'tus';
  endpoint: string;
  /** Headers the TUS client must send with every request. */
  headers: Record<string, string>;
  /** TUS Upload-Metadata entries. */
  metadata: Record<string, string>;
  expiresAt: Date;
}

/** Short-lived playback configuration for an authorised viewer. Token protection, not DRM. */
export interface PlaybackAuthorization {
  kind: 'iframe';
  url: string;
  expiresAt: Date;
  protection: 'token';
}

export interface ProviderUsage {
  storageBytes: number;
  trafficBytes: number;
}

export interface ProviderStatistics {
  views: number;
  watchSeconds: number;
}

export interface VideoProvider {
  readonly key: 'BUNNY';
  isConfigured(): boolean;
  /** Groups an academy's videos on the provider (Bunny: collection). Returns the group id. */
  createGroup(name: string): Promise<string>;
  createVideo(input: { title: string; groupId?: string | null }): Promise<{ providerVideoId: string }>;
  authorizeUpload(providerVideoId: string, ttlSeconds: number, meta: { title: string; mimeType: string }): UploadAuthorization;
  getVideo(providerVideoId: string): Promise<ProviderVideo>;
  deleteVideo(providerVideoId: string): Promise<void>;
  reprocess(providerVideoId: string): Promise<void>;
  authorizePlayback(providerVideoId: string, ttlSeconds: number): PlaybackAuthorization;
  /** Readable stream of the original upload, when the provider keeps originals. */
  downloadOriginal(providerVideoId: string): Promise<{ stream: Readable; size: number | null } | null>;
  /** Server-side upload of a file into an existing video entry (restore). */
  uploadFile(providerVideoId: string, body: Readable, size: number): Promise<void>;
  libraryUsage(): Promise<ProviderUsage | null>;
  statistics(range: { from: Date; to: Date; providerVideoId?: string }): Promise<ProviderStatistics>;
}

export const VIDEO_PROVIDER = Symbol('VIDEO_PROVIDER');

/**
 * Extension point for premium DRM (Widevine / FairPlay). Not implemented: Bunny token
 * authentication is access control, not DRM. A DRM provider would issue license-bound playback.
 */
export interface DrmPlaybackProvider {
  readonly drm: 'widevine' | 'fairplay' | 'multi';
  authorizeDrmPlayback(providerVideoId: string, viewer: { userId: string; sessionId: string }): Promise<PlaybackAuthorization & { licenseUrl: string }>;
}
