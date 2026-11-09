import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { CryptoService } from '../../core/crypto/crypto.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../core/redis/redis.constants.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { GoogleMeetError, GoogleMeetService } from './google-meet.service.js';
import { ZoomError, ZoomService } from './zoom.service.js';

export type IntegrationKind = 'ZOOM' | 'GOOGLE_MEET';
const STATE_TTL = 600;

type SessionWithClass = {
  id: string; tenantId: string; startsAt: Date; endsAt: Date; status: string; providerMeetingId: string | null; providerJoinUrl: string | null;
  liveClass: { id: string; provider: string; title: string; description: string | null; durationMinutes: number; timezone: string; waitingRoom: boolean; recordSessions: boolean; kind: string };
};

/**
 * Academies' own Zoom and Google accounts (OAuth): connection, token refresh, and the meetings
 * created for each live session. Provider failures never block scheduling: the error is kept on
 * the session and the worker retries.
 */
@Injectable()
export class LiveIntegrationsService {
  private readonly log = new Logger(LiveIntegrationsService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly crypto: CryptoService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly zoom: ZoomService,
    private readonly meet: GoogleMeetService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  private svcConfigured(p: IntegrationKind) {
    return p === 'ZOOM' ? this.zoom.isConfigured() : this.meet.isConfigured();
  }

  async status() {
    const rows = await this.db.liveIntegration.findMany();
    const one = (p: IntegrationKind) => {
      const r = rows.find((x) => x.provider === p);
      return { available: this.svcConfigured(p), connected: r?.status === 'CONNECTED', status: r?.status ?? null, accountEmail: r?.accountEmail ?? null, lastError: r?.lastError ?? null, connectedAt: r?.createdAt ?? null };
    };
    return { zoom: one('ZOOM'), googleMeet: one('GOOGLE_MEET') };
  }

  async isConnected(p: IntegrationKind) {
    return this.svcConfigured(p) && Boolean(await this.db.liveIntegration.findFirst({ where: { provider: p, status: 'CONNECTED' } }));
  }

  async connectUrl(p: IntegrationKind, userId: string) {
    if (!this.svcConfigured(p)) throw AppException.integrationNotConfigured(p === 'ZOOM' ? 'Zoom' : 'Google Meet');
    const state = randomBytes(24).toString('base64url');
    await this.redis.set(`live-int:state:${state}`, JSON.stringify({ tenantId: this.ctx.requireTenantId(), userId, provider: p }), 'EX', STATE_TTL);
    return { url: p === 'ZOOM' ? this.zoom.authorizeUrl(state) : this.meet.authorizeUrl(state) };
  }

  private webUrl(query: string) {
    return `${this.config.get('WEB_PUBLIC_URL').replace(/\/+$/, '')}/creator/integrations?${query}`;
  }

  /** OAuth redirect (public). Returns where to send the browser next. */
  async callback(p: IntegrationKind, params: { code?: string; state?: string; error?: string }) {
    const key = p === 'ZOOM' ? 'zoom' : 'google-meet';
    const raw = params.state ? await this.redis.getdel(`live-int:state:${params.state.slice(0, 64)}`) : null;
    if (!raw) return this.webUrl(`error=${encodeURIComponent('This connection link expired. Try again.')}&provider=${key}`);
    const st = JSON.parse(raw) as { tenantId: string; userId: string; provider: IntegrationKind; coachUserId?: string };
    if (st.coachUserId && p === 'GOOGLE_MEET') return this.coachCallback(st as Required<typeof st>, params);
    if (st.provider !== p) return this.webUrl(`error=${encodeURIComponent('Connection mismatch. Try again.')}&provider=${key}`);
    if (params.error || !params.code) return this.webUrl(`error=${encodeURIComponent(params.error === 'access_denied' ? 'Access was not granted.' : 'The connection was cancelled.')}&provider=${key}`);
    try {
      await this.ctx.run(st.tenantId, async () => {
        let data: { accountEmail: string | null; externalUserId: string | null; externalAccountId: string | null; accessTokenEnc: string | null; refreshTokenEnc: string; tokenExpiresAt: Date | null; scopes: string | null };
        if (p === 'ZOOM') {
          const t = await this.zoom.exchangeCode(params.code!);
          const me = await this.zoom.me(t.accessToken);
          data = { accountEmail: me.email, externalUserId: me.id, externalAccountId: me.accountId, accessTokenEnc: this.crypto.encrypt(t.accessToken), refreshTokenEnc: this.crypto.encrypt(t.refreshToken), tokenExpiresAt: t.expiresAt, scopes: t.scopes.slice(0, 1000) };
        } else {
          const t = await this.meet.exchangeCode(params.code!);
          data = { accountEmail: t.email, externalUserId: t.subject, externalAccountId: null, accessTokenEnc: null, refreshTokenEnc: this.crypto.encrypt(t.refreshToken), tokenExpiresAt: null, scopes: t.scopes.slice(0, 1000) };
        }
        await this.prisma.liveIntegration.upsert({
          where: { tenantId_provider: { tenantId: st.tenantId, provider: p } },
          create: { tenantId: st.tenantId, provider: p, status: 'CONNECTED', connectedById: st.userId, ...data },
          update: { status: 'CONNECTED', lastError: null, connectedById: st.userId, ...data },
        });
        await this.audit.record({ action: `live_integration.connect`, tenantId: st.tenantId, actorUserId: st.userId, actorRealm: 'PLATFORM', targetType: 'LiveIntegration', after: { provider: p, email: data.accountEmail } });
      });
      return this.webUrl(`connected=${key}`);
    } catch (e) {
      this.log.warn(`${p} connect failed: ${(e as Error).message}`);
      return this.webUrl(`error=${encodeURIComponent((e as Error).message.slice(0, 200))}&provider=${key}`);
    }
  }

  /** A coach connected their own Google Calendar from Coaching settings. */
  private async coachCallback(st: { tenantId: string; userId: string; coachUserId: string }, params: { code?: string; error?: string }) {
    const back = (q: string) => `${this.config.get('WEB_PUBLIC_URL').replace(/\/+$/, '')}/creator/coaching?settings=1&${q}`;
    if (params.error || !params.code) return back(`error=${encodeURIComponent(params.error === 'access_denied' ? 'Access was not granted.' : 'The connection was cancelled.')}`);
    try {
      const t = await this.meet.exchangeCode(params.code);
      if (!t.scopes.includes('calendar.freebusy')) throw new Error('Allow access to your calendar’s free/busy times so bookings avoid your other events.');
      await this.ctx.run(st.tenantId, async () => {
        const data = { googleEmail: t.email, googleRefreshTokenEnc: this.crypto.encrypt(t.refreshToken), googleError: null };
        const existing = await this.db.coachProfile.findFirst({ where: { userId: st.coachUserId } });
        if (existing) await this.db.coachProfile.update({ where: { id: existing.id }, data });
        else {
          const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: st.tenantId }, select: { timezone: true } });
          await this.db.coachProfile.create({ data: { userId: st.coachUserId, timezone: tenant.timezone, ...data } as never });
        }
        await this.audit.record({ action: 'coaching.google_connect', tenantId: st.tenantId, actorUserId: st.userId, actorRealm: 'PLATFORM', targetType: 'User', targetId: st.coachUserId, after: { email: t.email } });
      });
      return back('connected=google');
    } catch (e) {
      this.log.warn(`coach calendar connect failed: ${(e as Error).message}`);
      return back(`error=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
    }
  }

  async disconnect(p: IntegrationKind, actorUserId: string) {
    const r = await this.db.liveIntegration.findFirst({ where: { provider: p } });
    if (!r) return this.status();
    if (p === 'GOOGLE_MEET') await this.meet.revoke(this.crypto.decrypt(r.refreshTokenEnc));
    await this.db.liveIntegration.delete({ where: { id: r.id } });
    await this.audit.record({ action: 'live_integration.disconnect', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'LiveIntegration', targetId: r.id, after: { provider: p } });
    return this.status();
  }

  /** Zoom removed the app (app_deauthorized): stop using the tokens. */
  async deauthorizeZoom(zoomUserId: string, accountId: string | null) {
    const rows = await this.prisma.liveIntegration.findMany({ where: { provider: 'ZOOM', externalUserId: zoomUserId, ...(accountId ? { externalAccountId: accountId } : {}) } });
    for (const r of rows) await this.prisma.liveIntegration.update({ where: { id: r.id }, data: { status: 'REVOKED', accessTokenEnc: null, lastError: 'The Zoom app was removed from the Zoom account. Connect again to use Zoom.' } });
    return rows.length;
  }

  // ── tokens ────────────────────────────────────────────────
  private async connection(p: IntegrationKind) {
    const r = await this.db.liveIntegration.findFirst({ where: { provider: p } });
    if (!r || r.status !== 'CONNECTED') throw new ZoomError(`${p === 'ZOOM' ? 'Zoom' : 'Google'} is not connected for this academy`, false);
    return r;
  }

  private async markError(id: string, message: string) {
    await this.prisma.liveIntegration.update({ where: { id }, data: { status: 'ERROR', lastError: message.slice(0, 500) } });
  }

  /** Valid Zoom access token; refreshes (Zoom rotates refresh tokens) when it is about to expire. */
  private async zoomToken() {
    const r = await this.connection('ZOOM');
    if (r.accessTokenEnc && r.tokenExpiresAt && r.tokenExpiresAt.getTime() - 60_000 > Date.now()) return this.crypto.decrypt(r.accessTokenEnc);
    const lock = `live-int:refresh:${r.id}`;
    if (!(await this.redis.set(lock, '1', 'EX', 20, 'NX'))) {
      await new Promise((res) => setTimeout(res, 1500));
      const again = await this.connection('ZOOM');
      if (again.accessTokenEnc && again.tokenExpiresAt && again.tokenExpiresAt > new Date()) return this.crypto.decrypt(again.accessTokenEnc);
    }
    try {
      const t = await this.zoom.refresh(this.crypto.decrypt(r.refreshTokenEnc));
      await this.prisma.liveIntegration.update({ where: { id: r.id }, data: { accessTokenEnc: this.crypto.encrypt(t.accessToken), refreshTokenEnc: this.crypto.encrypt(t.refreshToken), tokenExpiresAt: t.expiresAt, lastError: null } });
      return t.accessToken;
    } catch (e) {
      if (e instanceof ZoomError && !e.retryable) await this.markError(r.id, 'Zoom refused to renew access. Connect Zoom again.');
      throw e;
    } finally {
      await this.redis.del(lock);
    }
  }

  private async googleRefresh() {
    return this.crypto.decrypt((await this.connection('GOOGLE_MEET')).refreshTokenEnc);
  }

  private async guard<T>(p: IntegrationKind, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      // Revoked grants show up as 401 (Zoom) or invalid_grant (Google): flag the connection.
      const status = (e as ZoomError | GoogleMeetError).status;
      if ((status === 401 || /invalid_grant/.test((e as Error).message)) && !(e instanceof ZoomError && e.message.includes('not connected'))) {
        const r = await this.db.liveIntegration.findFirst({ where: { provider: p } });
        if (r) await this.markError(r.id, `${p === 'ZOOM' ? 'Zoom' : 'Google'} access was revoked or expired. Connect again.`);
      }
      throw e;
    }
  }

  // ── meetings ──────────────────────────────────────────────
  private zoomInput(s: SessionWithClass) {
    return { topic: s.liveClass.title, startTime: s.startsAt, durationMinutes: Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000), timezone: s.liveClass.timezone, agenda: s.liveClass.description, waitingRoom: s.liveClass.waitingRoom, record: s.liveClass.recordSessions, registration: true };
  }

  private meetInput(s: SessionWithClass) {
    return { summary: s.liveClass.title, description: s.liveClass.description, start: s.startsAt, end: s.endsAt, timezone: s.liveClass.timezone };
  }

  /** Creates the provider meeting for a session if it has none. Never throws; returns success. */
  async ensureMeeting(sessionId: string) {
    const s = await this.db.liveSession.findFirst({ where: { id: sessionId }, include: { liveClass: true } }) as SessionWithClass | null;
    if (!s || !['ZOOM', 'GOOGLE_MEET'].includes(s.liveClass.provider) || s.providerMeetingId || s.status === 'CANCELLED' || s.status === 'ENDED') return true;
    try {
      if (s.liveClass.provider === 'ZOOM') {
        const m = await this.guard('ZOOM', async () => {
          const token = await this.zoomToken();
          try {
            return await this.zoom.createMeeting(token, this.zoomInput(s));
          } catch (e) {
            // Basic (free) Zoom accounts cannot use registration; fall back to the shared meeting link.
            if (e instanceof ZoomError && e.status === 400) return this.zoom.createMeeting(token, { ...this.zoomInput(s), registration: false });
            throw e;
          }
        });
        await this.db.liveSession.update({ where: { id: s.id }, data: { providerMeetingId: m.id, providerJoinUrl: m.joinUrl, providerPassword: m.password, providerSyncError: null } });
      } else {
        const ev = await this.guard('GOOGLE_MEET', async () => this.meet.createEvent(await this.googleRefresh(), this.meetInput(s)));
        await this.db.liveSession.update({ where: { id: s.id }, data: { providerMeetingId: ev.eventId, providerJoinUrl: ev.joinUrl, providerSyncError: null } });
      }
      return true;
    } catch (e) {
      this.log.warn(`meeting for session ${s.id} failed: ${(e as Error).message}`);
      await this.db.liveSession.update({ where: { id: s.id }, data: { providerSyncError: (e as Error).message.slice(0, 300) } });
      return false;
    }
  }

  /** Pushes class changes (title, time, settings) to every upcoming session's meeting. */
  async updateMeetings(classId: string) {
    const sessions = await this.db.liveSession.findMany({ where: { liveClassId: classId, status: 'SCHEDULED', startsAt: { gt: new Date() } }, include: { liveClass: true } }) as SessionWithClass[];
    for (const s of sessions) {
      if (!s.providerMeetingId) { await this.ensureMeeting(s.id); continue; }
      try {
        if (s.liveClass.provider === 'ZOOM') await this.guard('ZOOM', async () => this.zoom.updateMeeting(await this.zoomToken(), s.providerMeetingId!, this.zoomInput(s)));
        else await this.guard('GOOGLE_MEET', async () => this.meet.updateEvent(await this.googleRefresh(), s.providerMeetingId!, this.meetInput(s)));
        await this.db.liveSession.update({ where: { id: s.id }, data: { providerSyncError: null } });
      } catch (e) {
        await this.db.liveSession.update({ where: { id: s.id }, data: { providerSyncError: (e as Error).message.slice(0, 300) } });
      }
    }
  }

  /** Deletes a cancelled session's meeting (best effort; a provider error is logged). */
  async removeMeeting(s: { id: string; providerMeetingId: string | null }, provider: string) {
    if (!s.providerMeetingId || !['ZOOM', 'GOOGLE_MEET'].includes(provider)) return;
    try {
      if (provider === 'ZOOM') await this.guard('ZOOM', async () => this.zoom.deleteMeeting(await this.zoomToken(), s.providerMeetingId!));
      else await this.guard('GOOGLE_MEET', async () => this.meet.deleteEvent(await this.googleRefresh(), s.providerMeetingId!));
    } catch (e) {
      this.log.warn(`could not delete meeting of session ${s.id}: ${(e as Error).message}`);
    }
  }

  /** Host start link for Zoom (read fresh because it expires). */
  async zoomStartUrl(meetingId: string) {
    return this.guard('ZOOM', async () => (await this.zoom.getMeeting(await this.zoomToken(), meetingId)).startUrl);
  }

  /** Personal Zoom join link for an attendee (registrant), created once per session. */
  async zoomJoinUrl(s: { id: string; providerMeetingId: string; providerJoinUrl: string | null }, who: { identity: string; name: string; email: string | null }) {
    const existing = await this.db.liveSessionRegistrant.findFirst({ where: { sessionId: s.id, identity: who.identity } });
    if (existing) return existing.joinUrl;
    if (!who.email) return s.providerJoinUrl;
    try {
      const [first, ...rest] = who.name.trim().split(/\s+/);
      const r = await this.guard('ZOOM', async () => this.zoom.addRegistrant(await this.zoomToken(), s.providerMeetingId, { email: who.email!, firstName: first || 'Student', lastName: rest.join(' ') || undefined }));
      await this.db.liveSessionRegistrant.create({ data: { sessionId: s.id, identity: who.identity, registrantId: r.registrantId, joinUrl: r.joinUrl } as never }).catch(() => undefined);
      return r.joinUrl;
    } catch (e) {
      // Registration off (basic account) or not allowed for this meeting: everyone uses the meeting link.
      if (e instanceof ZoomError && e.status && e.status < 500) return s.providerJoinUrl;
      throw e;
    }
  }

  /** Worker: create meetings that failed earlier for upcoming sessions. */
  async retryMissing(now = new Date()) {
    const rows = await this.prisma.liveSession.findMany({ where: { status: 'SCHEDULED', providerMeetingId: null, startsAt: { gt: now }, liveClass: { provider: { in: ['ZOOM', 'GOOGLE_MEET'] }, status: 'ACTIVE' } }, select: { id: true, tenantId: true }, take: 100 });
    let ok = 0;
    for (const r of rows) if (await this.ctx.run(r.tenantId, () => this.ensureMeeting(r.id))) ok++;
    return { tried: rows.length, created: ok };
  }
}
