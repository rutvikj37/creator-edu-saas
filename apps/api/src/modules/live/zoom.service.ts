import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { safeEqual } from '../../core/crypto/crypto.service.js';
import { AppConfig } from '../../config/app-config.service.js';

/** Zoom rejected or could not be reached. `retryable` = transient (network/5xx/429). */
export class ZoomError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status?: number, readonly code?: number) {
    super(message);
  }
}

export interface ZoomTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string;
}

export interface ZoomMeetingInput {
  topic: string;
  startTime: Date;
  durationMinutes: number;
  timezone: string;
  agenda?: string | null;
  waitingRoom: boolean;
  record: boolean;
  /** Registration gives each attendee a personal join link (licensed Zoom hosts only). */
  registration: boolean;
}

export interface ZoomMeeting {
  id: string;
  joinUrl: string;
  startUrl: string | null;
  password: string | null;
}

/**
 * Zoom REST API and OAuth for user-managed apps. Endpoint paths, request bodies and response
 * fields follow Zoom's official Node SDK (`@zoom/rivet` 0.4.0): token requests are form posts to
 * `{oauth}/oauth/token` with HTTP Basic client credentials; API calls use the bearer access token
 * against `{api}`; errors carry `{ code, message }`; webhooks are signed with
 * `v0=HMAC_SHA256(secret, "v0:{x-zm-request-timestamp}:{body}")`.
 */
@Injectable()
export class ZoomService {
  constructor(private readonly config: AppConfig) {}

  isConfigured() {
    return Boolean(this.config.get('ZOOM_CLIENT_ID') && this.config.get('ZOOM_CLIENT_SECRET') && this.config.get('ZOOM_WEBHOOK_SECRET_TOKEN'));
  }

  redirectUri() {
    return `${this.config.get('API_PUBLIC_URL').replace(/\/+$/, '')}/api/v1/integrations/zoom/callback`;
  }

  private get oauthBase() {
    return this.config.get('ZOOM_OAUTH_BASE_URL').replace(/\/+$/, '');
  }

  private get apiBase() {
    return this.config.get('ZOOM_API_BASE_URL').replace(/\/+$/, '');
  }

  authorizeUrl(state: string) {
    const u = new URL('/oauth/authorize', this.oauthBase);
    u.searchParams.set('client_id', this.config.get('ZOOM_CLIENT_ID')!);
    u.searchParams.set('redirect_uri', this.redirectUri());
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('state', state);
    return u.toString();
  }

  private async tokenRequest(params: Record<string, string>): Promise<ZoomTokens> {
    const basic = Buffer.from(`${this.config.get('ZOOM_CLIENT_ID')}:${this.config.get('ZOOM_CLIENT_SECRET')}`).toString('base64');
    let res: Response;
    try {
      res = await fetch(`${this.oauthBase}/oauth/token`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new ZoomError(`Zoom unreachable (${new URL(this.oauthBase).host}): ${(e as Error).message}`, true);
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') {
      throw new ZoomError(`Zoom token request failed: ${String(data.reason ?? data.error ?? res.status)}`, res.status >= 500 || res.status === 429, res.status);
    }
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + Number(data.expires_in ?? 3600) * 1000), scopes: String(data.scope ?? '') };
  }

  exchangeCode(code: string) {
    return this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri() });
  }

  refresh(refreshToken: string) {
    return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  private async api<T>(token: string, method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const u = new URL(this.apiBase + path);
    for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
    let res: Response;
    try {
      res = await fetch(u, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new ZoomError(`Zoom unreachable (${u.host}): ${(e as Error).message}`, true);
    }
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new ZoomError(`Zoom: ${String(data.message ?? `HTTP ${res.status}`)}`, res.status >= 500 || res.status === 429, res.status, Number(data.code) || undefined);
    return data as T;
  }

  async me(token: string) {
    const u = await this.api<{ id: string; email?: string; account_id?: string }>(token, 'GET', '/users/me');
    return { id: u.id, email: u.email ?? null, accountId: u.account_id ?? null };
  }

  private body(m: ZoomMeetingInput) {
    return {
      topic: m.topic.slice(0, 200), type: 2, start_time: m.startTime.toISOString().replace(/\.\d{3}Z$/, 'Z'), duration: m.durationMinutes, timezone: m.timezone,
      ...(m.agenda ? { agenda: m.agenda.slice(0, 2000) } : {}),
      settings: {
        join_before_host: false, waiting_room: m.waitingRoom, auto_recording: m.record ? 'cloud' : 'none', mute_upon_entry: true,
        host_video: true, participant_video: false,
        ...(m.registration ? { approval_type: 0, registration_type: 1, registrants_email_notification: false, registrants_confirmation_email: false } : { approval_type: 2 }),
      },
    };
  }

  async createMeeting(token: string, m: ZoomMeetingInput): Promise<ZoomMeeting> {
    const r = await this.api<{ id: number | string; join_url: string; start_url?: string; password?: string }>(token, 'POST', '/users/me/meetings', this.body(m));
    return { id: String(r.id), joinUrl: r.join_url, startUrl: r.start_url ?? null, password: r.password ?? null };
  }

  async updateMeeting(token: string, meetingId: string, m: ZoomMeetingInput) {
    await this.api(token, 'PATCH', `/meetings/${encodeURIComponent(meetingId)}`, this.body(m));
  }

  async deleteMeeting(token: string, meetingId: string) {
    try {
      await this.api(token, 'DELETE', `/meetings/${encodeURIComponent(meetingId)}`, undefined, { cancel_meeting_reminder: 'false' });
    } catch (e) {
      if (e instanceof ZoomError && e.status === 404) return; // already gone
      throw e;
    }
  }

  /** Fresh host start link (start_url expires, so it is read right before the host starts). */
  async getMeeting(token: string, meetingId: string): Promise<ZoomMeeting> {
    const r = await this.api<{ id: number | string; join_url: string; start_url?: string; password?: string }>(token, 'GET', `/meetings/${encodeURIComponent(meetingId)}`);
    return { id: String(r.id), joinUrl: r.join_url, startUrl: r.start_url ?? null, password: r.password ?? null };
  }

  async addRegistrant(token: string, meetingId: string, p: { email: string; firstName: string; lastName?: string }) {
    const r = await this.api<{ registrant_id: string; join_url: string }>(token, 'POST', `/meetings/${encodeURIComponent(meetingId)}/registrants`, { email: p.email, first_name: p.firstName.slice(0, 64) || 'Student', ...(p.lastName ? { last_name: p.lastName.slice(0, 64) } : {}), auto_approve: true });
    return { registrantId: r.registrant_id, joinUrl: r.join_url };
  }

  // ── webhooks ──────────────────────────────────────────────
  private sign(message: string) {
    return createHmac('sha256', this.config.get('ZOOM_WEBHOOK_SECRET_TOKEN')!).update(message).digest('hex');
  }

  /** Checks `x-zm-signature` against the raw body (and the re-serialised JSON, as Zoom's SDK does). */
  verifyWebhook(rawBody: string, signature: string | undefined, timestamp: string | undefined) {
    if (!this.isConfigured() || !signature || !timestamp) return false;
    const expect = (body: string) => `v0=${this.sign(`v0:${timestamp}:${body}`)}`;
    if (safeEqual(signature, expect(rawBody))) return true;
    try {
      return safeEqual(signature, expect(JSON.stringify(JSON.parse(rawBody))));
    } catch {
      return false;
    }
  }

  /** Answer to `endpoint.url_validation`. */
  urlValidation(plainToken: string) {
    return { plainToken, encryptedToken: this.sign(plainToken) };
  }

  /** Cloud recording file. Zoom's webhook supplies a short-lived `download_token` for it. */
  async downloadRecording(downloadUrl: string, downloadToken: string): Promise<{ stream: Readable; size: number | null }> {
    const u = new URL(downloadUrl);
    u.searchParams.set('access_token', downloadToken);
    let res: Response;
    try {
      res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(30 * 60_000) });
    } catch (e) {
      throw new ZoomError(`download: ${(e as Error).message}`, true);
    }
    if (!res.ok || !res.body) throw new ZoomError(`download: HTTP ${res.status}`, res.status >= 500 || res.status === 429, res.status);
    const len = Number(res.headers.get('content-length'));
    return { stream: Readable.fromWeb(res.body as never), size: Number.isFinite(len) && len > 0 ? len : null };
  }
}
