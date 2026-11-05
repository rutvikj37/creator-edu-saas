import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { ERROR_CODES } from '@ce/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../core/redis/redis.constants.js';
import { StorageService } from '../../core/storage/storage.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { isEnrollmentUsable } from '../learning/access.js';
import { isValidTimeZone } from '../../common/time/timezone.js';
import { type LiveGrant, LiveKitService } from './livekit.service.js';
import { MATERIALIZE_DAYS, mergedSeconds, occurrences, type Recurrence, validRecurrence } from './recurrence.js';

const DAY = 86_400_000;
/** Students can join this long before the start; hosts a little earlier. */
export const JOIN_OPENS_MIN = 15;
const HOST_OPENS_MIN = 30;
/** Joining stays possible this long after the scheduled end unless the host ended the session. */
const JOIN_CLOSES_AFTER_MIN = 30;
const EXTERNAL_URL = /^https:\/\/[^\s]+$/i;

export interface ClassInput {
  kind?: 'CLASS' | 'WEBINAR';
  title?: string;
  description?: string | null;
  provider?: 'LIVEKIT' | 'EXTERNAL';
  externalUrl?: string | null;
  audience?: 'COURSE' | 'BATCH' | 'ALL_STUDENTS' | 'REGISTRANTS';
  courseId?: string | null;
  batchId?: string | null;
  startsAt?: string;
  durationMinutes?: number;
  timezone?: string;
  recurrence?: Recurrence | null;
  capacity?: number | null;
  waitingRoom?: boolean;
  recordSessions?: boolean;
  hostUserId?: string;
}

const STUDENT: LiveGrant = { canPublish: true, canSubscribe: true, canPublishData: true };
const WEBINAR_ATTENDEE: LiveGrant = { canPublish: false, canSubscribe: true, canPublishData: true };
const WAITING: LiveGrant = { canPublish: false, canSubscribe: false, canPublishData: false };
const HOST: LiveGrant = { canPublish: true, canSubscribe: true, canPublishData: true, roomAdmin: true };

@Injectable()
export class LiveService {
  private readonly logger = new Logger(LiveService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly livekit: LiveKitService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  providers() {
    return { livekit: this.livekit.isConfigured(), external: true, recording: this.livekit.isConfigured() && this.storage.driver === 's3' };
  }

  // ── classes ───────────────────────────────────────────────
  private async validate(input: ClassInput, current?: { provider: string; audience: string; kind: string }) {
    const errors: { field: string; message: string }[] = [];
    const provider = input.provider ?? current?.provider;
    const kind = input.kind ?? current?.kind ?? 'CLASS';
    const audience = input.audience ?? current?.audience ?? (kind === 'WEBINAR' ? 'REGISTRANTS' : undefined);
    if (input.title !== undefined && (!input.title.trim() || input.title.trim().length > 200)) errors.push({ field: 'title', message: '1–200 characters' });
    if (provider === 'LIVEKIT' && !this.livekit.isConfigured()) errors.push({ field: 'provider', message: 'The built-in classroom is not set up on this platform yet. Use a meeting link instead.' });
    if (provider === 'EXTERNAL' && input.externalUrl !== undefined && !EXTERNAL_URL.test(input.externalUrl ?? '')) errors.push({ field: 'externalUrl', message: 'Paste your Zoom, Google Meet or Teams link (https://…)' });
    if (kind === 'WEBINAR' && audience !== 'REGISTRANTS') errors.push({ field: 'audience', message: 'Webinars are for registered attendees' });
    if (kind === 'CLASS' && audience === 'REGISTRANTS') errors.push({ field: 'audience', message: 'Choose who can attend this class' });
    if (audience === 'COURSE' && input.courseId !== undefined) {
      if (!input.courseId || !(await this.db.course.findFirst({ where: { id: input.courseId, deletedAt: null } }))) errors.push({ field: 'courseId', message: 'Choose a course' });
    }
    if (audience === 'BATCH' && input.batchId !== undefined) {
      if (!input.batchId || !(await this.db.batch.findFirst({ where: { id: input.batchId, archivedAt: null } }))) errors.push({ field: 'batchId', message: 'Choose a batch' });
    }
    if (input.startsAt !== undefined && Number.isNaN(Date.parse(input.startsAt))) errors.push({ field: 'startsAt', message: 'Choose a start time' });
    if (input.timezone !== undefined && !isValidTimeZone(input.timezone)) errors.push({ field: 'timezone', message: 'Unknown time zone' });
    if (input.recurrence !== undefined && !validRecurrence(input.recurrence)) errors.push({ field: 'recurrence', message: 'Pick weekdays and an end (date or number of sessions)' });
    if (input.recordSessions && !this.providers().recording) errors.push({ field: 'recordSessions', message: 'Recording needs the built-in classroom with S3 storage configured' });
    if (input.recordSessions && provider === 'EXTERNAL') errors.push({ field: 'recordSessions', message: 'Meeting-link classes are recorded in Zoom/Meet itself' });
    if (input.waitingRoom && provider === 'EXTERNAL') errors.push({ field: 'waitingRoom', message: 'Use the waiting room in Zoom/Meet for meeting-link classes' });
    if (input.hostUserId) {
      const member = await this.db.tenantMember.findFirst({ where: { userId: input.hostUserId, status: 'ACTIVE' } });
      if (!member) errors.push({ field: 'hostUserId', message: 'The host must be a member of your team' });
    }
    if (errors.length) throw AppException.validation(errors);
  }

  private async uniqueSlug(title: string) {
    const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'webinar';
    for (let i = 0; i < 50; i++) {
      const s = i ? `${base}-${i + 1}` : base;
      if (!(await this.db.liveClass.findFirst({ where: { slug: s } }))) return s;
    }
    return `${base}-${randomBytes(3).toString('hex')}`;
  }

  async create(input: Required<Pick<ClassInput, 'title' | 'provider' | 'startsAt' | 'durationMinutes'>> & ClassInput, actorUserId: string) {
    const kind = input.kind ?? 'CLASS';
    const audience = input.audience ?? (kind === 'WEBINAR' ? 'REGISTRANTS' : 'ALL_STUDENTS');
    await this.validate({ ...input, kind, audience, externalUrl: input.provider === 'EXTERNAL' ? input.externalUrl ?? '' : input.externalUrl });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: this.ctx.requireTenantId() }, select: { timezone: true } });
    const timezone = input.timezone ?? tenant.timezone;
    const first = new Date(input.startsAt);
    if (first.getTime() < Date.now() - 5 * 60_000) throw AppException.validation([{ field: 'startsAt', message: 'Choose a time in the future' }]);
    const c = await this.db.liveClass.create({
      data: {
        kind, title: input.title.trim(), description: input.description?.trim() || null, provider: input.provider, externalUrl: input.provider === 'EXTERNAL' ? input.externalUrl!.trim() : null,
        audience, courseId: audience === 'COURSE' ? input.courseId : null, batchId: audience === 'BATCH' ? input.batchId : null, hostUserId: input.hostUserId ?? actorUserId,
        durationMinutes: input.durationMinutes, timezone, recurrence: (input.recurrence ?? null) as never, capacity: input.capacity ?? null, waitingRoom: Boolean(input.waitingRoom),
        recordSessions: Boolean(input.recordSessions), slug: kind === 'WEBINAR' ? await this.uniqueSlug(input.title) : null, createdById: actorUserId,
      } as never,
    });
    await this.materialize(c.id, first);
    await this.audit.record({ action: 'live.create', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'LiveClass', targetId: c.id, after: { title: c.title, kind, provider: c.provider } });
    return this.get(c.id);
  }

  /** Creates sessions for upcoming occurrences (up to 90 days ahead). Idempotent. */
  async materialize(classId: string, first?: Date) {
    const c = await this.db.liveClass.findFirst({ where: { id: classId }, include: { sessions: { orderBy: { startsAt: 'asc' }, take: 1 } } });
    if (!c || c.status !== 'ACTIVE') return 0;
    const start = first ?? c.sessions[0]?.startsAt;
    if (!start) return 0;
    const times = occurrences(start, c.timezone, c.recurrence as Recurrence | null, new Date(Date.now() + MATERIALIZE_DAYS * DAY));
    let created = 0;
    for (const at of times) {
      const exists = await this.db.liveSession.findFirst({ where: { liveClassId: c.id, startsAt: at } });
      if (exists) continue;
      await this.db.liveSession.create({ data: { liveClassId: c.id, startsAt: at, endsAt: new Date(at.getTime() + c.durationMinutes * 60_000), roomName: `ce_${randomBytes(12).toString('hex')}` } as never });
      created++;
    }
    return created;
  }

  async list(params: { kind?: 'CLASS' | 'WEBINAR' }) {
    const rows = await this.db.liveClass.findMany({
      where: { ...(params.kind ? { kind: params.kind } : {}) },
      include: { sessions: { where: { status: { in: ['SCHEDULED', 'LIVE'] } }, orderBy: { startsAt: 'asc' }, take: 1 } },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
    return rows.map((c) => ({ ...this.classView(c), nextSession: c.sessions[0] ? this.sessionView(c.sessions[0]) : null }));
  }

  private classView(c: any) {
    return {
      id: c.id, kind: c.kind, title: c.title, description: c.description, provider: c.provider, externalUrl: c.externalUrl, audience: c.audience, courseId: c.courseId, batchId: c.batchId,
      hostUserId: c.hostUserId, durationMinutes: c.durationMinutes, timezone: c.timezone, recurrence: c.recurrence, capacity: c.capacity, waitingRoom: c.waitingRoom,
      recordSessions: c.recordSessions, slug: c.slug, status: c.status, createdAt: c.createdAt,
    };
  }

  private sessionView(s: any) {
    return { id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status, startedAt: s.startedAt, endedAt: s.endedAt, recordingStatus: s.recordingStatus, videoAssetId: s.videoAssetId };
  }

  async get(id: string) {
    const c = await this.db.liveClass.findFirst({ where: { id }, include: { sessions: { orderBy: { startsAt: 'asc' } } } });
    if (!c) throw AppException.notFound('Live class not found');
    const registrations = c.kind === 'WEBINAR' ? await this.db.webinarRegistration.count({ where: { liveClassId: c.id } }) : null;
    return { ...this.classView(c), sessions: c.sessions.map((s) => this.sessionView(s)), registrations };
  }

  async update(id: string, input: ClassInput, actorUserId: string) {
    const c = await this.db.liveClass.findFirst({ where: { id } });
    if (!c) throw AppException.notFound('Live class not found');
    await this.validate(input, c);
    await this.db.liveClass.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.externalUrl !== undefined && c.provider === 'EXTERNAL' ? { externalUrl: input.externalUrl } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.waitingRoom !== undefined ? { waitingRoom: input.waitingRoom } : {}),
        ...(input.recordSessions !== undefined ? { recordSessions: input.recordSessions } : {}),
        ...(input.hostUserId !== undefined ? { hostUserId: input.hostUserId } : {}),
      },
    });
    await this.audit.record({ action: 'live.update', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'LiveClass', targetId: id, after: input as never });
    return this.get(id);
  }

  async cancelClass(id: string, actorUserId: string) {
    const c = await this.db.liveClass.findFirst({ where: { id } });
    if (!c) throw AppException.notFound('Live class not found');
    await this.db.liveClass.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.db.liveSession.updateMany({ where: { liveClassId: id, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
    await this.audit.record({ action: 'live.cancel', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'LiveClass', targetId: id });
    return this.get(id);
  }

  async cancelSession(sessionId: string, actorUserId: string) {
    const s = await this.db.liveSession.findFirst({ where: { id: sessionId } });
    if (!s) throw AppException.notFound('Session not found');
    if (s.status !== 'SCHEDULED') throw AppException.conflict('Only upcoming sessions can be cancelled.');
    await this.db.liveSession.update({ where: { id: s.id }, data: { status: 'CANCELLED' } });
    await this.audit.record({ action: 'live.session_cancel', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'LiveSession', targetId: s.id });
    return this.get(s.liveClassId);
  }

  // ── access ────────────────────────────────────────────────
  private async session(sessionId: string) {
    const s = await this.db.liveSession.findFirst({ where: { id: sessionId }, include: { liveClass: true } });
    if (!s || s.liveClass.status !== 'ACTIVE') throw AppException.notFound('Session not found');
    return s;
  }

  /** Whether a student (or webinar registrant) may attend. */
  async mayAttend(c: { id: string; audience: string; courseId: string | null; batchId: string | null }, userId: string | null, registrationId: string | null) {
    if (registrationId) return Boolean(await this.db.webinarRegistration.findFirst({ where: { id: registrationId, liveClassId: c.id } }));
    if (!userId) return false;
    switch (c.audience) {
      case 'ALL_STUDENTS':
        return true;
      case 'COURSE':
        return isEnrollmentUsable(await this.db.enrollment.findFirst({ where: { userId, courseId: c.courseId! } }));
      case 'BATCH':
        return Boolean(await this.db.batchMember.findFirst({ where: { batchId: c.batchId!, userId } }));
      case 'REGISTRANTS':
        return Boolean(await this.db.webinarRegistration.findFirst({ where: { liveClassId: c.id, userId } }));
      default:
        return false;
    }
  }

  private windowCheck(s: { startsAt: Date; endsAt: Date; status: string }, host: boolean) {
    const now = Date.now();
    if (s.status === 'CANCELLED') throw AppException.conflict('This session was cancelled.');
    if (s.status === 'ENDED') throw AppException.conflict('This session has ended.');
    const opens = s.startsAt.getTime() - (host ? HOST_OPENS_MIN : JOIN_OPENS_MIN) * 60_000;
    if (now < opens) throw new AppException(ERROR_CODES.CONFLICT, `Joining opens ${host ? HOST_OPENS_MIN : JOIN_OPENS_MIN} minutes before the start.`, HttpStatus.CONFLICT);
    if (!host && s.status !== 'LIVE' && now > s.endsAt.getTime() + JOIN_CLOSES_AFTER_MIN * 60_000) throw AppException.conflict('This session is over.');
  }

  /** Join as a student/attendee. Returns a LiveKit token, or the meeting link for EXTERNAL classes. */
  async join(sessionId: string, who: { userId: string | null; registrationId: string | null; name: string }) {
    const s = await this.session(sessionId);
    const c = s.liveClass;
    if (!(await this.mayAttend(c, who.userId, who.registrationId))) throw AppException.forbidden(c.kind === 'WEBINAR' ? 'Register for this webinar to join.' : 'This live class is for enrolled students.');
    this.windowCheck(s, false);
    const identity = who.registrationId ? `reg_${who.registrationId}` : `usr_${who.userId}`;
    if (c.provider === 'EXTERNAL') {
      await this.db.liveAttendance.create({ data: { sessionId: s.id, identity, userId: who.userId, registrationId: who.registrationId, displayName: who.name.slice(0, 120), role: 'attendee', source: 'click', joinedAt: new Date(), leftAt: new Date() } as never });
      return { provider: 'EXTERNAL' as const, joinUrl: c.externalUrl! };
    }
    if (c.capacity) {
      const present = await this.db.liveAttendance.findMany({ where: { sessionId: s.id, leftAt: null, role: { not: 'host' } }, distinct: ['identity'], select: { identity: true } });
      if (present.length >= c.capacity && !present.some((p) => p.identity === identity)) throw AppException.conflict('This session is full.');
    }
    let waiting = false;
    if (c.waitingRoom) {
      const adm = await this.db.liveAdmission.findFirst({ where: { sessionId: s.id, identity } });
      if (adm?.status === 'DENIED') throw AppException.forbidden('The host did not admit you to this session.');
      if (!adm) await this.db.liveAdmission.create({ data: { sessionId: s.id, identity, name: who.name.slice(0, 120) } as never });
      waiting = adm?.status !== 'ADMITTED';
    }
    await this.ensureRoom(s, c.capacity);
    const grant = waiting ? WAITING : c.kind === 'WEBINAR' ? WEBINAR_ATTENDEE : STUDENT;
    const ttl = Math.max(3600, Math.round((s.endsAt.getTime() - Date.now()) / 1000) + 2 * 3600);
    const token = await this.livekit.token(s.roomName, identity, who.name, grant, { role: 'attendee', waiting, sessionId: s.id }, ttl);
    return { provider: 'LIVEKIT' as const, url: this.livekit.wsUrl(), token, identity, waiting, role: 'attendee' as const };
  }

  private async ensureRoom(s: { roomName: string }, capacity: number | null) {
    // Creating an existing room is a no-op on LiveKit; cache to avoid a call per join.
    if (await this.redis.set(`live:room:${s.roomName}`, '1', 'EX', 6 * 3600, 'NX')) {
      try {
        await this.livekit.ensureRoom(s.roomName, capacity ? capacity + 5 : null);
      } catch (e) {
        await this.redis.del(`live:room:${s.roomName}`);
        this.logger.error({ err: (e as Error).message }, 'LiveKit createRoom failed');
        throw new AppException(ERROR_CODES.INTEGRATION_NOT_CONFIGURED, 'The live classroom is unavailable right now. Please try again shortly.', HttpStatus.SERVICE_UNAVAILABLE);
      }
    }
  }

  /** Join as host (staff). Starts the session and recording when enabled. */
  async host(sessionId: string, actor: { userId: string; name: string }) {
    const s = await this.session(sessionId);
    const c = s.liveClass;
    this.windowCheck(s, true);
    if (c.provider === 'EXTERNAL') return { provider: 'EXTERNAL' as const, joinUrl: c.externalUrl! };
    await this.ensureRoom(s, c.capacity);
    if (s.status === 'SCHEDULED') {
      await this.db.liveSession.update({ where: { id: s.id }, data: { status: 'LIVE', startedAt: new Date() } });
      if (c.recordSessions && this.storage.driver === 's3' && !s.egressId) await this.startRecording(s.id, s.roomName);
    }
    const identity = `host_${actor.userId}`;
    const token = await this.livekit.token(s.roomName, identity, actor.name, HOST, { role: 'host', sessionId: s.id }, 6 * 3600);
    return { provider: 'LIVEKIT' as const, url: this.livekit.wsUrl(), token, identity, waiting: false, role: 'host' as const };
  }

  private async startRecording(sessionId: string, roomName: string) {
    const tenantId = this.ctx.requireTenantId();
    try {
      const egressId = await this.livekit.startRecording(roomName, {
        bucket: this.config.get('S3_PRIVATE_BUCKET'), region: this.config.get('AWS_REGION'), accessKey: this.config.get('AWS_ACCESS_KEY_ID') ?? '', secret: this.config.get('AWS_SECRET_ACCESS_KEY') ?? '',
        endpoint: this.config.get('S3_ENDPOINT') || undefined,
      }, `tenants/${tenantId}/live_recording/${sessionId}.mp4`);
      await this.db.liveSession.update({ where: { id: sessionId }, data: { egressId, recordingStatus: 'RECORDING' } });
    } catch (e) {
      this.logger.error({ err: (e as Error).message, sessionId }, 'could not start recording');
      await this.db.liveSession.update({ where: { id: sessionId }, data: { recordingStatus: 'FAILED' } });
    }
  }

  async end(sessionId: string, actorUserId: string) {
    const s = await this.session(sessionId);
    if (s.status === 'ENDED') return this.get(s.liveClassId);
    const now = new Date();
    if (s.liveClass.provider === 'LIVEKIT') {
      if (s.egressId && s.recordingStatus === 'RECORDING') {
        await this.livekit.stopRecording(s.egressId).catch((e) => this.logger.warn({ err: (e as Error).message }, 'stopEgress failed'));
        await this.db.liveSession.update({ where: { id: s.id }, data: { recordingStatus: 'PROCESSING' } });
      }
      await this.livekit.deleteRoom(s.roomName).catch((e) => this.logger.warn({ err: (e as Error).message }, 'deleteRoom failed'));
      await this.redis.del(`live:room:${s.roomName}`);
    }
    await this.db.liveSession.update({ where: { id: s.id }, data: { status: 'ENDED', endedAt: now, startedAt: s.startedAt ?? now } });
    await this.db.liveAttendance.updateMany({ where: { sessionId: s.id, leftAt: null }, data: { leftAt: now } });
    await this.audit.record({ action: 'live.session_end', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'LiveSession', targetId: s.id });
    return this.get(s.liveClassId);
  }

  /** Resolves a participant identity for polls/Q&A, checking they may attend this session. */
  async participant(sessionId: string, who: { userId: string | null; registrationId: string | null; staff: boolean }) {
    const s = await this.session(sessionId);
    if (who.staff) return { session: s, identity: `host_${who.userId}`, host: true };
    if (!(await this.mayAttend(s.liveClass, who.userId, who.registrationId))) throw AppException.forbidden('You are not part of this session.');
    return { session: s, identity: who.registrationId ? `reg_${who.registrationId}` : `usr_${who.userId}`, host: false };
  }

  // ── waiting room ──────────────────────────────────────────
  async admissions(sessionId: string) {
    await this.session(sessionId);
    return this.db.liveAdmission.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
  }

  async decide(sessionId: string, admissionId: string, admit: boolean) {
    const s = await this.session(sessionId);
    const a = await this.db.liveAdmission.findFirst({ where: { id: admissionId, sessionId } });
    if (!a) throw AppException.notFound('Request not found');
    await this.db.liveAdmission.update({ where: { id: a.id }, data: { status: admit ? 'ADMITTED' : 'DENIED', decidedAt: new Date() } });
    try {
      if (admit) await this.livekit.setPermissions(s.roomName, a.identity, s.liveClass.kind === 'WEBINAR' ? WEBINAR_ATTENDEE : STUDENT, { role: 'attendee', waiting: false, sessionId: s.id });
      else await this.livekit.removeParticipant(s.roomName, a.identity);
    } catch (e) {
      // The participant may have left; the stored decision applies on their next join.
      this.logger.warn({ err: (e as Error).message }, 'LiveKit participant update failed');
    }
    return this.admissions(sessionId);
  }

  /** Polled by a waiting participant's client. */
  async admissionStatus(sessionId: string, identity: string) {
    const a = await this.db.liveAdmission.findFirst({ where: { sessionId, identity } });
    return { status: a?.status ?? 'ADMITTED' };
  }

  // ── attendance ────────────────────────────────────────────
  async attendance(sessionId: string) {
    const s = await this.session(sessionId);
    const rows = await this.db.liveAttendance.findMany({ where: { sessionId: s.id }, orderBy: { joinedAt: 'asc' } });
    const scheduled = Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 1000);
    const end = s.endedAt ?? new Date();
    const byIdentity = new Map<string, typeof rows>();
    for (const r of rows) byIdentity.set(r.identity, [...(byIdentity.get(r.identity) ?? []), r]);
    const people = [...byIdentity.entries()].map(([identity, list]) => {
      const seconds = list[0].source === 'click' ? null : mergedSeconds(list.map((r) => ({ from: r.joinedAt, to: r.leftAt ?? end })));
      return {
        identity, name: list[0].displayName, userId: list[0].userId, registrationId: list[0].registrationId, role: list[0].role, source: list[0].source,
        firstJoinedAt: list[0].joinedAt, seconds, percent: seconds === null ? null : Math.min(100, Math.round((seconds / scheduled) * 100)),
      };
    });
    return { session: this.sessionView(s), scheduledSeconds: scheduled, people: people.sort((a, b) => (b.seconds ?? 0) - (a.seconds ?? 0)) };
  }

  async attendanceCsv(sessionId: string) {
    const a = await this.attendance(sessionId);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Name', 'Role', 'First joined (UTC)', 'Minutes attended', 'Attendance %', 'Source'].map(esc).join(',')];
    for (const p of a.people) lines.push([p.name, p.role, p.firstJoinedAt.toISOString(), p.seconds === null ? '' : Math.round(p.seconds / 60), p.percent ?? '', p.source].map(esc).join(','));
    return lines.join('\n');
  }

  // ── webhooks (LiveKit) ────────────────────────────────────
  async handleWebhook(rawBody: string, auth: string | undefined) {
    if (!this.livekit.isConfigured()) throw AppException.notFound('Not configured');
    let e;
    try {
      e = await this.livekit.verifyWebhook(rawBody, auth);
    } catch {
      throw new AppException(ERROR_CODES.UNAUTHENTICATED, 'Invalid webhook signature', HttpStatus.UNAUTHORIZED);
    }
    if (!(await this.redis.set(`live:evt:${e.id}`, '1', 'EX', 7 * 86_400, 'NX'))) return { received: true, duplicate: true };
    if (!e.roomName) return { received: true };
    const s = await this.prisma.liveSession.findUnique({ where: { roomName: e.roomName } });
    if (!s) return { received: true, ignored: true };
    await this.ctx.run(s.tenantId, () => this.applyEvent(s, e));
    return { received: true };
  }

  private async applyEvent(s: { id: string; tenantId: string; status: string; egressId: string | null }, e: Awaited<ReturnType<LiveKitService['verifyWebhook']>>) {
    switch (e.event) {
      case 'room_started':
        if (s.status === 'SCHEDULED') await this.db.liveSession.update({ where: { id: s.id }, data: { status: 'LIVE', startedAt: e.at } });
        return;
      case 'room_finished':
        if (s.status !== 'ENDED') await this.db.liveSession.update({ where: { id: s.id }, data: { status: 'ENDED', endedAt: e.at } });
        await this.db.liveAttendance.updateMany({ where: { sessionId: s.id, leftAt: null }, data: { leftAt: e.at } });
        return;
      case 'participant_joined': {
        if (!e.identity) return;
        const { userId, registrationId, role } = this.parseIdentity(e.identity);
        const name = await this.displayName(userId, registrationId);
        await this.db.liveAttendance.create({ data: { sessionId: s.id, identity: e.identity, userId, registrationId, displayName: name, role, source: 'livekit', joinedAt: e.at } as never });
        return;
      }
      case 'participant_left': {
        if (!e.identity) return;
        const open = await this.db.liveAttendance.findFirst({ where: { sessionId: s.id, identity: e.identity, leftAt: null }, orderBy: { joinedAt: 'desc' } });
        if (open) await this.db.liveAttendance.update({ where: { id: open.id }, data: { leftAt: e.at } });
        return;
      }
      case 'egress_ended':
        if (e.egress && e.egress.id === s.egressId) await this.importRecording(s.id, e.egress);
        return;
      default:
    }
  }

  private parseIdentity(identity: string) {
    const [kind, id] = [identity.slice(0, identity.indexOf('_')), identity.slice(identity.indexOf('_') + 1)];
    return { userId: kind === 'usr' || kind === 'host' ? id : null, registrationId: kind === 'reg' ? id : null, role: kind === 'host' ? 'host' : 'attendee' };
  }

  private async displayName(userId: string | null, registrationId: string | null) {
    if (userId) return (await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }))?.fullName ?? 'Participant';
    if (registrationId) return (await this.db.webinarRegistration.findFirst({ where: { id: registrationId }, select: { name: true } }))?.name ?? 'Guest';
    return 'Participant';
  }

  /** Turns a finished LiveKit recording in S3 into a library video the creator can attach to lessons. */
  private async importRecording(sessionId: string, egress: NonNullable<Awaited<ReturnType<LiveKitService['verifyWebhook']>>['egress']>) {
    const s = await this.db.liveSession.findFirst({ where: { id: sessionId }, include: { liveClass: true } });
    if (!s) return;
    if (egress.error || !egress.fileLocation) {
      await this.db.liveSession.update({ where: { id: s.id }, data: { recordingStatus: 'FAILED' } });
      return;
    }
    const key = `tenants/${s.tenantId}/live_recording/${s.id}.mp4`;
    const size = await this.storage.objectSize(key).catch(() => null);
    const file = await this.db.fileAsset.create({
      data: { ownerUserId: s.liveClass.hostUserId, purpose: 'VIDEO_SOURCE', fileName: `${s.liveClass.title.slice(0, 150)} ${s.startsAt.toISOString().slice(0, 10)}.mp4`, mimeType: 'video/mp4', sizeBytes: BigInt(size ?? 0), driver: 's3', bucket: this.config.get('S3_PRIVATE_BUCKET'), key, status: 'READY' } as never,
    });
    const video = await this.db.videoAsset.create({
      data: { title: `${s.liveClass.title} — ${s.startsAt.toISOString().slice(0, 10)}`, sourceFileId: file.id, provider: 'STORAGE', status: 'READY', durationSeconds: egress.durationSeconds, createdById: s.liveClass.hostUserId } as never,
    });
    await this.db.liveSession.update({ where: { id: s.id }, data: { recordingStatus: 'READY', videoAssetId: video.id } });
  }

  // ── student views ─────────────────────────────────────────
  async upcomingFor(userId: string) {
    const sessions = await this.db.liveSession.findMany({
      where: { status: { in: ['SCHEDULED', 'LIVE'] }, endsAt: { gt: new Date(Date.now() - JOIN_CLOSES_AFTER_MIN * 60_000) }, liveClass: { status: 'ACTIVE' } },
      include: { liveClass: true }, orderBy: { startsAt: 'asc' }, take: 200,
    });
    const out = [];
    for (const s of sessions) {
      if (!(await this.mayAttend(s.liveClass, userId, null))) continue;
      out.push({ ...this.sessionView(s), liveClass: { id: s.liveClass.id, title: s.liveClass.title, kind: s.liveClass.kind, provider: s.liveClass.provider, description: s.liveClass.description }, joinOpensAt: new Date(s.startsAt.getTime() - JOIN_OPENS_MIN * 60_000) });
      if (out.length >= 50) break;
    }
    return out;
  }

  async recordingsFor(userId: string) {
    const sessions = await this.db.liveSession.findMany({ where: { recordingStatus: 'READY', videoAssetId: { not: null } }, include: { liveClass: true }, orderBy: { startsAt: 'desc' }, take: 100 });
    const out = [];
    for (const s of sessions) if (await this.mayAttend(s.liveClass, userId, null)) out.push({ ...this.sessionView(s), liveClass: { id: s.liveClass.id, title: s.liveClass.title } });
    return out;
  }

  /** Signed URL of a session recording for someone allowed to attend. */
  async recordingUrl(sessionId: string, who: { userId: string | null; registrationId: string | null; staff?: boolean }, apiOrigin: string) {
    const s = await this.session(sessionId);
    if (!who.staff && !(await this.mayAttend(s.liveClass, who.userId, who.registrationId))) throw AppException.forbidden('You are not part of this session.');
    if (s.recordingStatus !== 'READY' || !s.videoAssetId) throw AppException.notFound('No recording for this session');
    const v = await this.db.videoAsset.findFirst({ where: { id: s.videoAssetId } });
    const f = v?.sourceFileId && (await this.db.fileAsset.findFirst({ where: { id: v.sourceFileId } }));
    if (!f) throw AppException.notFound('No recording for this session');
    return { url: await this.storage.downloadUrl(f, f.fileName, apiOrigin, 4 * 3600), title: v!.title, durationSeconds: v!.durationSeconds };
  }

  // ── audience (for reminders) ──────────────────────────────
  async audienceEmails(c: { id: string; audience: string; courseId: string | null; batchId: string | null }) {
    const tenantId = this.ctx.requireTenantId();
    if (c.audience === 'REGISTRANTS') return (await this.db.webinarRegistration.findMany({ where: { liveClassId: c.id }, select: { email: true, name: true, userId: true } })).map((r) => ({ email: r.email, name: r.name, userId: undefined as string | undefined }));
    let userIds: string[] | null = null;
    if (c.audience === 'COURSE') userIds = (await this.db.enrollment.findMany({ where: { courseId: c.courseId!, status: 'ACTIVE' }, select: { userId: true } })).map((e) => e.userId);
    if (c.audience === 'BATCH') userIds = (await this.db.batchMember.findMany({ where: { batchId: c.batchId! }, select: { userId: true } })).map((m) => m.userId);
    const users = await this.prisma.user.findMany({ where: { tenantId, realm: 'TENANT', status: 'ACTIVE', deletedAt: null, ...(userIds ? { id: { in: userIds } } : {}) }, select: { id: true, email: true, fullName: true }, take: 10_000 });
    return users.map((u) => ({ email: u.email, name: u.fullName, userId: u.id as string | undefined }));
  }
}
