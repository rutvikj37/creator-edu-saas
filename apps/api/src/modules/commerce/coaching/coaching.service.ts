import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { AppException } from '../../../common/errors/app-exception.js';
import { validateRichText } from '../../../common/richtext/richtext.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { escapeHtml } from '../../../core/mail/templates.js';
import { MailService } from '../../../core/mail/mail.service.js';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../../core/redis/redis.constants.js';
import { StorageService } from '../../../core/storage/storage.service.js';
import { TENANT_PRISMA } from '../../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.service.js';
import { FilesService } from '../../files/files.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { slugify } from '../../tenants/slug.js';
import { isTimeZone, localDay, zonedToUtc } from './timezone.js';

type Doc = Record<string, unknown>;
export interface ProgramInput {
  title?: string;
  description?: Doc | null;
  coverFileId?: string | null;
  faqs?: { question: string; answer: string }[];
  planName?: string | null;
  priceAmount?: number;
  compareAtAmount?: number | null;
  coaches?: { userId: string; weight: number }[];
  /** Ordered sessions; `id` keeps an existing one. */
  sessions?: { id?: string; title: string; durationMin: number; agenda: Doc; notes?: string | null; attachmentIds?: string[] }[];
}
export interface ProfileInput {
  timezone?: string;
  meetingUrl?: string | null;
  minNoticeHours?: number;
  bufferMin?: number;
  /** Replaces the weekly hours. */
  hours?: { weekday: number; startMinute: number; endMinute: number }[];
}

const DAY = 86_400_000;
const HORIZON_DAYS = 30;
const SLOT_STEP_MIN = 15;
const MAX_SESSIONS = 50;
const LIVE = ['BOOKED', 'COMPLETED'] as const;

/**
 * 1:1 coaching. A program has sessions and coaches; a buyer books each session once, at a time
 * one of the program's coaches is free (weekly hours in the coach's timezone, minus existing
 * bookings, notice period and buffer). When several coaches are free, the booking goes to the
 * one with the fewest bookings relative to their weight, so a weight of 2 gets twice as many.
 */
@Injectable()
export class CoachingService {
  private readonly log = new Logger(CoachingService.name);

  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly files: FilesService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ── programs (academy) ────────────────────────────────────
  private async uniqueSlug(base: string, excludeId?: string) {
    const root = slugify(base).slice(0, 100) || 'coaching';
    for (let i = 0; i < 100; i++) {
      const candidate = i === 0 ? root : `${root}-${i + 1}`;
      if (!(await this.db.coachingProgram.findFirst({ where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } }))) return candidate;
    }
    return `${root}-${Date.now().toString(36)}`;
  }

  private async load(id: string) {
    const p = await this.db.coachingProgram.findFirst({ where: { id } });
    if (!p) throw AppException.notFound('Coaching program not found');
    return p;
  }

  private async parts(programId: string) {
    const [coaches, sessions] = await Promise.all([
      this.db.coachingCoach.findMany({ where: { programId }, orderBy: { id: 'asc' } }),
      this.db.coachingSession.findMany({ where: { programId }, orderBy: { position: 'asc' } }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: coaches.map((c) => c.userId) } }, select: { id: true, fullName: true, email: true } });
    return { coaches: coaches.map((c) => ({ userId: c.userId, weight: c.weight, name: users.find((u) => u.id === c.userId)?.fullName ?? '', email: users.find((u) => u.id === c.userId)?.email ?? '' })), sessions };
  }

  private async view(p: Awaited<ReturnType<CoachingService['load']>>, apiOrigin: string) {
    const { coaches, sessions } = await this.parts(p.id);
    const [buyers, bookings, revenue] = await Promise.all([
      this.db.coachingAccess.count({ where: { programId: p.id, revokedAt: null } }),
      this.db.coachingBooking.count({ where: { programId: p.id, status: { in: [...LIVE] } } }),
      this.db.orderItem.aggregate({ where: { coachingProgramId: p.id, order: { status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } }, _sum: { totalAmount: true } }),
    ]);
    const assets = await this.db.fileAsset.findMany({ where: { id: { in: sessions.flatMap((s) => s.attachmentIds as string[]) } }, select: { id: true, fileName: true, sizeBytes: true } });
    return {
      id: p.id, title: p.title, slug: p.slug, description: p.description, faqs: p.faqs, planName: p.planName, status: p.status, publishedAt: p.publishedAt,
      priceAmount: p.priceAmount.toString(), compareAtAmount: p.compareAtAmount?.toString() ?? null, currency: p.currency, isFree: Number(p.priceAmount) === 0,
      coverFileId: p.coverFileId, coverUrl: await this.files.urlFor(p.coverFileId, apiOrigin, 86_400),
      coaches,
      sessions: sessions.map((s) => ({
        id: s.id, title: s.title, durationMin: s.durationMin, agenda: s.agenda, notes: s.notes,
        attachments: (s.attachmentIds as string[]).map((id) => assets.find((a) => a.id === id)).filter(Boolean).map((a) => ({ id: a!.id, fileName: a!.fileName, sizeBytes: Number(a!.sizeBytes) })),
      })),
      buyers, bookings, revenue: revenue._sum.totalAmount?.toString() ?? '0', createdAt: p.createdAt, updatedAt: p.updatedAt,
    };
  }

  async list(apiOrigin: string) {
    const rows = await this.db.coachingProgram.findMany({ where: { status: { not: 'ARCHIVED' } }, orderBy: { createdAt: 'desc' } });
    return Promise.all(rows.map((p) => this.view(p, apiOrigin)));
  }

  async get(id: string, apiOrigin: string) {
    return this.view(await this.load(id), apiOrigin);
  }

  /** Totals for the Coaching page header. */
  async stats() {
    const paid = { coachingProgramId: { not: null }, order: { status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } } as const;
    const [bookings, upcoming, revenue, tenant] = await Promise.all([
      this.db.coachingBooking.count({ where: { status: { in: [...LIVE] } } }),
      this.db.coachingBooking.count({ where: { status: 'BOOKED', startsAt: { gt: new Date() } } }),
      this.db.orderItem.aggregate({ where: paid as never, _sum: { totalAmount: true } }),
      this.prisma.tenant.findUniqueOrThrow({ where: { id: this.ctx.requireTenantId() }, select: { defaultCurrency: true } }),
    ]);
    return { totalBookings: bookings, upcomingBookings: upcoming, totalRevenue: revenue._sum.totalAmount?.toString() ?? '0', currency: tenant.defaultCurrency };
  }

  private async validate(input: ProgramInput, programId?: string) {
    const errors: { field: string; message: string }[] = [];
    if (input.title !== undefined && (!input.title.trim() || input.title.trim().length > 100)) errors.push({ field: 'title', message: 'Name your program (up to 100 characters)' });
    if (input.description) { try { validateRichText(input.description); } catch { errors.push({ field: 'description', message: 'The description has unsupported formatting' }); } }
    if (input.priceAmount !== undefined && !(input.priceAmount >= 0)) errors.push({ field: 'priceAmount', message: 'Enter a price (0 for free)' });
    if (input.compareAtAmount && input.priceAmount !== undefined && input.compareAtAmount <= input.priceAmount) errors.push({ field: 'compareAtAmount', message: 'The original price must be higher than the sale price' });
    if (input.coverFileId) await this.files.assertUsable(input.coverFileId, ['IMAGE', 'COURSE_THUMBNAIL', 'COURSE_BANNER']).catch(() => errors.push({ field: 'coverFileId', message: 'Upload an image' }));
    if (input.faqs) {
      if (input.faqs.length > 30) errors.push({ field: 'faqs', message: 'Up to 30 questions' });
      if (input.faqs.some((f) => !f.question?.trim() || !f.answer?.trim())) errors.push({ field: 'faqs', message: 'Every question needs an answer' });
    }
    if (input.coaches) {
      if (new Set(input.coaches.map((c) => c.userId)).size !== input.coaches.length) errors.push({ field: 'coaches', message: 'Each coach can be added once' });
      if (input.coaches.some((c) => !Number.isInteger(c.weight) || c.weight < 1 || c.weight > 10)) errors.push({ field: 'coaches', message: 'Weights are whole numbers from 1 to 10' });
      const members = await this.db.tenantMember.count({ where: { userId: { in: input.coaches.map((c) => c.userId) }, status: 'ACTIVE' } });
      if (members !== input.coaches.length) errors.push({ field: 'coaches', message: 'Coaches must be active members of your team' });
    }
    if (input.sessions) {
      const existing = programId ? await this.db.coachingSession.findMany({ where: { programId }, select: { id: true } }) : [];
      if (input.sessions.length > MAX_SESSIONS) errors.push({ field: 'sessions', message: `Up to ${MAX_SESSIONS} sessions` });
      for (const s of input.sessions) {
        if (s.id && !existing.some((e) => e.id === s.id)) errors.push({ field: 'sessions', message: 'A session was not found on this program' });
        if (!s.title?.trim() || s.title.trim().length > 100) errors.push({ field: 'sessions', message: 'Give every session a name' });
        if (!Number.isInteger(s.durationMin) || s.durationMin < 15 || s.durationMin > 480) errors.push({ field: 'sessions', message: 'Sessions last 15 minutes to 8 hours' });
        try { validateRichText(s.agenda); } catch { errors.push({ field: 'sessions', message: 'Write an agenda for every session' }); }
        for (const f of s.attachmentIds ?? []) await this.files.assertUsable(f, ['LESSON_FILE']).catch(() => errors.push({ field: 'sessions', message: 'An attachment is not ready yet' }));
      }
    }
    if (errors.length) throw AppException.validation(errors);
  }

  private async writeParts(programId: string, input: ProgramInput) {
    if (input.coaches) {
      await this.db.coachingCoach.deleteMany({ where: { programId, userId: { notIn: input.coaches.length ? input.coaches.map((c) => c.userId) : ['-'] } } });
      for (const c of input.coaches) {
        const row = await this.db.coachingCoach.findFirst({ where: { programId, userId: c.userId } });
        if (row) await this.db.coachingCoach.update({ where: { id: row.id }, data: { weight: c.weight } });
        else await this.db.coachingCoach.create({ data: { programId, userId: c.userId, weight: c.weight } as never });
      }
    }
    if (input.sessions) {
      const keep = input.sessions.filter((s) => s.id).map((s) => s.id!);
      const dropped = await this.db.coachingSession.findMany({ where: { programId, id: { notIn: keep.length ? keep : ['-'] } }, select: { id: true } });
      if (dropped.length && (await this.db.coachingBooking.count({ where: { sessionId: { in: dropped.map((d) => d.id) }, status: 'BOOKED', startsAt: { gt: new Date() } } }))) {
        throw AppException.conflict('A session you removed has upcoming bookings. Cancel those bookings first.');
      }
      await this.db.coachingSession.deleteMany({ where: { id: { in: dropped.map((d) => d.id) } } });
      for (const [i, s] of input.sessions.entries()) {
        const data = { position: i, title: s.title.trim(), durationMin: s.durationMin, agenda: s.agenda as never, notes: s.notes?.trim() || null, attachmentIds: (s.attachmentIds ?? []) as never };
        if (s.id) await this.db.coachingSession.update({ where: { id: s.id }, data });
        else await this.db.coachingSession.create({ data: { programId, ...data } as never });
      }
    }
  }

  async create(input: ProgramInput & { title: string }, actorUserId: string, apiOrigin: string) {
    await this.validate({ priceAmount: 0, ...input });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: this.ctx.requireTenantId() }, select: { defaultCurrency: true } });
    const p = await this.db.coachingProgram.create({
      data: {
        title: input.title.trim(), slug: await this.uniqueSlug(input.title), description: (input.description ?? null) as never, coverFileId: input.coverFileId ?? null,
        faqs: (input.faqs ?? []).map((f) => ({ question: f.question.trim(), answer: f.answer.trim() })) as never, planName: input.planName?.trim() || null,
        priceAmount: input.priceAmount ?? 0, compareAtAmount: input.compareAtAmount ?? null, currency: tenant.defaultCurrency, createdById: actorUserId,
      } as never,
    });
    await this.writeParts(p.id, { coaches: input.coaches ?? [{ userId: actorUserId, weight: 1 }], sessions: input.sessions });
    await this.audit.record({ action: 'coaching.create', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'CoachingProgram', targetId: p.id, after: { title: p.title } });
    return this.get(p.id, apiOrigin);
  }

  async update(id: string, input: ProgramInput, actorUserId: string, apiOrigin: string) {
    const p = await this.load(id);
    await this.validate({ ...input, priceAmount: input.priceAmount ?? Number(p.priceAmount) }, id);
    await this.db.coachingProgram.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: (input.description ?? null) as never } : {}),
        ...(input.coverFileId !== undefined ? { coverFileId: input.coverFileId } : {}),
        ...(input.faqs !== undefined ? { faqs: input.faqs.map((f) => ({ question: f.question.trim(), answer: f.answer.trim() })) as never } : {}),
        ...(input.planName !== undefined ? { planName: input.planName?.trim() || null } : {}),
        ...(input.priceAmount !== undefined ? { priceAmount: input.priceAmount } : {}),
        ...(input.compareAtAmount !== undefined ? { compareAtAmount: input.compareAtAmount } : {}),
      },
    });
    await this.writeParts(id, input);
    if (p.status === 'PUBLISHED') await this.assertPublishable(id);
    await this.audit.record({ action: 'coaching.update', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'CoachingProgram', targetId: id });
    return this.get(id, apiOrigin);
  }

  private async assertPublishable(id: string) {
    const [coaches, sessions] = await Promise.all([this.db.coachingCoach.count({ where: { programId: id } }), this.db.coachingSession.count({ where: { programId: id } })]);
    const errors = [];
    if (!coaches) errors.push({ field: 'coaches', message: 'Add at least one coach' });
    if (!sessions) errors.push({ field: 'sessions', message: 'Add at least one session' });
    if (errors.length) throw AppException.validation(errors);
  }

  async setStatus(id: string, status: 'PUBLISHED' | 'DRAFT' | 'ARCHIVED', actorUserId: string, apiOrigin: string) {
    const p = await this.load(id);
    if (status === 'PUBLISHED') await this.assertPublishable(id);
    await this.db.coachingProgram.update({ where: { id }, data: { status, ...(status === 'PUBLISHED' && !p.publishedAt ? { publishedAt: new Date() } : {}) } });
    await this.audit.record({ action: `coaching.${status.toLowerCase()}`, tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'CoachingProgram', targetId: id });
    return this.get(id, apiOrigin);
  }

  // ── coach profiles and hours ──────────────────────────────
  async profile(userId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: this.ctx.requireTenantId() }, select: { timezone: true } });
    const [p, hours, user] = await Promise.all([
      this.db.coachProfile.findFirst({ where: { userId } }),
      this.db.coachAvailability.findMany({ where: { userId }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, email: true } }),
    ]);
    return {
      userId, name: user?.fullName ?? '', email: user?.email ?? '',
      timezone: p?.timezone ?? tenant.timezone, meetingUrl: p?.meetingUrl ?? null, minNoticeHours: p?.minNoticeHours ?? 12, bufferMin: p?.bufferMin ?? 0,
      hours: hours.map((h) => ({ weekday: h.weekday, startMinute: h.startMinute, endMinute: h.endMinute })), configured: Boolean(p),
    };
  }

  /** Coaches on any program plus all active team members, for pickers and the availability screen. */
  async team() {
    const members = await this.db.tenantMember.findMany({ where: { status: 'ACTIVE' }, select: { userId: true, user: { select: { fullName: true, email: true } } } });
    const profiles = await this.db.coachProfile.findMany({ where: { userId: { in: members.map((m) => m.userId) } }, select: { userId: true } });
    return members.map((m) => ({ userId: m.userId, name: m.user.fullName, email: m.user.email, hasHours: profiles.some((p) => p.userId === m.userId) }));
  }

  async saveProfile(userId: string, input: ProfileInput, actorUserId: string) {
    if (!(await this.db.tenantMember.findFirst({ where: { userId, status: 'ACTIVE' } }))) throw AppException.notFound('Team member not found');
    const errors: { field: string; message: string }[] = [];
    if (input.timezone !== undefined && !isTimeZone(input.timezone)) errors.push({ field: 'timezone', message: 'Choose a valid timezone' });
    if (input.meetingUrl && !/^https:\/\/[^\s]{4,490}$/.test(input.meetingUrl)) errors.push({ field: 'meetingUrl', message: 'Paste an https:// meeting link (Zoom, Google Meet…)' });
    if (input.minNoticeHours !== undefined && !(Number.isInteger(input.minNoticeHours) && input.minNoticeHours >= 0 && input.minNoticeHours <= 720)) errors.push({ field: 'minNoticeHours', message: '0 to 720 hours' });
    if (input.bufferMin !== undefined && !(Number.isInteger(input.bufferMin) && input.bufferMin >= 0 && input.bufferMin <= 240)) errors.push({ field: 'bufferMin', message: '0 to 240 minutes' });
    for (const h of input.hours ?? []) {
      if (!(Number.isInteger(h.weekday) && h.weekday >= 0 && h.weekday <= 6) || !(Number.isInteger(h.startMinute) && Number.isInteger(h.endMinute) && h.startMinute >= 0 && h.endMinute <= 1440 && h.endMinute > h.startMinute)) {
        errors.push({ field: 'hours', message: 'Each time range must end after it starts, within one day' });
        break;
      }
    }
    const byDay = new Map<number, { startMinute: number; endMinute: number }[]>();
    for (const h of input.hours ?? []) byDay.set(h.weekday, [...(byDay.get(h.weekday) ?? []), h]);
    for (const list of byDay.values()) {
      list.sort((a, b) => a.startMinute - b.startMinute);
      if (list.some((h, i) => i > 0 && h.startMinute < list[i - 1].endMinute)) { errors.push({ field: 'hours', message: 'Time ranges on the same day overlap' }); break; }
    }
    if (errors.length) throw AppException.validation(errors);
    const current = await this.profile(userId);
    const data = {
      timezone: input.timezone ?? current.timezone, meetingUrl: input.meetingUrl !== undefined ? input.meetingUrl || null : current.meetingUrl,
      minNoticeHours: input.minNoticeHours ?? current.minNoticeHours, bufferMin: input.bufferMin ?? current.bufferMin,
    };
    const existing = await this.db.coachProfile.findFirst({ where: { userId } });
    if (existing) await this.db.coachProfile.update({ where: { id: existing.id }, data });
    else await this.db.coachProfile.create({ data: { userId, ...data } as never });
    if (input.hours) {
      await this.db.coachAvailability.deleteMany({ where: { userId } });
      for (const h of input.hours) await this.db.coachAvailability.create({ data: { userId, weekday: h.weekday, startMinute: h.startMinute, endMinute: h.endMinute } as never });
    }
    await this.audit.record({ action: 'coaching.availability', tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'User', targetId: userId });
    return this.profile(userId);
  }

  // ── slots and booking ─────────────────────────────────────
  /** Free start times for a session over the next 30 days, each with the coaches free then. */
  private async freeSlots(programId: string, durationMin: number, now = new Date()) {
    const coaches = await this.db.coachingCoach.findMany({ where: { programId } });
    const ids = coaches.map((c) => c.userId);
    const [profiles, hours, busy] = await Promise.all([
      this.db.coachProfile.findMany({ where: { userId: { in: ids } } }),
      this.db.coachAvailability.findMany({ where: { userId: { in: ids } } }),
      this.db.coachingBooking.findMany({ where: { coachId: { in: ids }, status: 'BOOKED', endsAt: { gt: now }, startsAt: { lt: new Date(now.getTime() + (HORIZON_DAYS + 1) * DAY) } }, select: { coachId: true, startsAt: true, endsAt: true } }),
    ]);
    const slots = new Map<number, string[]>();
    for (const coachId of ids) {
      const p = profiles.find((x) => x.userId === coachId);
      if (!p) continue; // no hours set yet
      const earliest = now.getTime() + p.minNoticeHours * 3_600_000;
      const mine = busy.filter((b) => b.coachId === coachId);
      const buffer = p.bufferMin * 60_000;
      for (let i = 0; i <= HORIZON_DAYS; i++) {
        const day = localDay(now.getTime(), p.timezone, i);
        for (const h of hours.filter((x) => x.userId === coachId && x.weekday === day.weekday)) {
          for (let m = h.startMinute; m + durationMin <= h.endMinute; m += SLOT_STEP_MIN) {
            const start = zonedToUtc(day.y, day.m, day.d, m, p.timezone).getTime();
            const end = start + durationMin * 60_000;
            if (start < earliest || start > now.getTime() + HORIZON_DAYS * DAY) continue;
            if (mine.some((b) => start < b.endsAt.getTime() + buffer && end + buffer > b.startsAt.getTime())) continue;
            slots.set(start, [...(slots.get(start) ?? []), coachId]);
          }
        }
      }
    }
    return { slots, coaches };
  }

  private async accessFor(userId: string, programId: string) {
    const access = await this.db.coachingAccess.findFirst({ where: { programId, userId, revokedAt: null } });
    if (!access) throw AppException.forbidden('Get this coaching program to book sessions.');
    const session = (sessionId: string) => this.db.coachingSession.findFirst({ where: { id: sessionId, programId } });
    return { access, session };
  }

  async slots(userId: string, programId: string, sessionId: string) {
    const { session } = await this.accessFor(userId, programId);
    const s = await session(sessionId);
    if (!s) throw AppException.notFound('Session not found');
    const { slots } = await this.freeSlots(programId, s.durationMin);
    return { durationMin: s.durationMin, slots: [...slots.keys()].sort((a, b) => a - b).slice(0, 1000).map((t) => new Date(t).toISOString()) };
  }

  async book(userId: string, programId: string, sessionId: string, startsAtIso: string) {
    const { access, session } = await this.accessFor(userId, programId);
    const s = await session(sessionId);
    if (!s) throw AppException.notFound('Session not found');
    const program = await this.load(programId);
    if (await this.db.coachingBooking.findFirst({ where: { accessId: access.id, sessionId, status: { in: [...LIVE] } } })) throw AppException.conflict('You have already booked this session. Cancel it first to pick another time.');
    const start = new Date(startsAtIso);
    if (Number.isNaN(start.getTime())) throw AppException.validation([{ field: 'startsAt', message: 'Pick a time' }]);
    const { slots, coaches } = await this.freeSlots(programId, s.durationMin);
    const free = slots.get(start.getTime()) ?? [];
    if (!free.length) throw AppException.conflict('That time is no longer available. Pick another slot.');

    // Weighted round-robin: fewest bookings per unit of weight goes first.
    const counts = await this.db.coachingBooking.groupBy({ by: ['coachId'], where: { programId, status: { in: [...LIVE] } }, _count: { _all: true } });
    const ranked = free
      .map((coachId) => ({ coachId, score: (counts.find((c) => c.coachId === coachId)?._count._all ?? 0) / (coaches.find((c) => c.userId === coachId)?.weight ?? 1) }))
      .sort((a, b) => a.score - b.score || a.coachId.localeCompare(b.coachId));
    const end = new Date(start.getTime() + s.durationMin * 60_000);
    for (const { coachId } of ranked) {
      const key = `coach-lock:${this.ctx.requireTenantId()}:${coachId}`;
      const token = randomBytes(8).toString('hex');
      if ((await this.redis.set(key, token, 'PX', 10_000, 'NX')) !== 'OK') continue;
      try {
        const profile = await this.db.coachProfile.findFirst({ where: { userId: coachId } });
        const buffer = (profile?.bufferMin ?? 0) * 60_000;
        const clash = await this.db.coachingBooking.findFirst({ where: { coachId, status: 'BOOKED', startsAt: { lt: new Date(end.getTime() + buffer) }, endsAt: { gt: new Date(start.getTime() - buffer) } } });
        if (clash) continue;
        const b = await this.db.coachingBooking.create({ data: { programId, sessionId, accessId: access.id, userId, coachId, startsAt: start, endsAt: end, meetingUrl: profile?.meetingUrl ?? null } as never });
        await this.announce(b.id, 'booked').catch((e) => this.log.warn(`booking email: ${(e as Error).message}`));
        return this.bookingView(b.id, program.title, s.title);
      } finally {
        if ((await this.redis.get(key)) === token) await this.redis.del(key);
      }
    }
    throw AppException.conflict('That time was just taken. Pick another slot.');
  }

  private async bookingView(id: string, programTitle?: string, sessionTitle?: string) {
    const b = await this.db.coachingBooking.findFirstOrThrow({ where: { id } });
    const coach = await this.prisma.user.findUnique({ where: { id: b.coachId }, select: { fullName: true } });
    return { id: b.id, programId: b.programId, sessionId: b.sessionId, programTitle, sessionTitle, coachId: b.coachId, coachName: coach?.fullName ?? '', startsAt: b.startsAt, endsAt: b.endsAt, status: b.status, meetingUrl: b.meetingUrl };
  }

  /** Student cancel: allowed until the coach's notice period before the start. */
  async cancelByStudent(userId: string, bookingId: string) {
    const b = await this.db.coachingBooking.findFirst({ where: { id: bookingId, userId } });
    if (!b) throw AppException.notFound('Booking not found');
    if (b.status !== 'BOOKED') throw AppException.conflict('This booking is not active.');
    const p = await this.db.coachProfile.findFirst({ where: { userId: b.coachId } });
    const notice = (p?.minNoticeHours ?? 12) * 3_600_000;
    if (b.startsAt.getTime() - Date.now() < notice) throw AppException.conflict(`Bookings can be cancelled up to ${p?.minNoticeHours ?? 12} hours before they start. Contact the academy.`);
    await this.db.coachingBooking.update({ where: { id: b.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'STUDENT' } });
    await this.announce(b.id, 'cancelled').catch(() => undefined);
    return { cancelled: true };
  }

  async setBookingStatus(bookingId: string, status: 'CANCELLED' | 'COMPLETED', actorUserId: string) {
    const b = await this.db.coachingBooking.findFirst({ where: { id: bookingId } });
    if (!b) throw AppException.notFound('Booking not found');
    if (b.status !== 'BOOKED') throw AppException.conflict('This booking is not active.');
    if (status === 'COMPLETED' && b.startsAt > new Date()) throw AppException.conflict('A session can be marked completed once it has started.');
    await this.db.coachingBooking.update({ where: { id: b.id }, data: { status, ...(status === 'CANCELLED' ? { cancelledAt: new Date(), cancelledBy: 'ACADEMY' } : {}) } });
    await this.audit.record({ action: `coaching.booking_${status.toLowerCase()}`, tenantId: this.ctx.tenantId, actorUserId, actorRealm: 'PLATFORM', targetType: 'CoachingBooking', targetId: b.id });
    if (status === 'CANCELLED') await this.announce(b.id, 'cancelled').catch(() => undefined);
    return { status };
  }

  /** Bookings for the academy: list (paged) or a date range for the calendar. */
  async bookings(params: { status?: string; programId?: string; coachId?: string; when?: string; from?: string; to?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));
    const now = new Date();
    const where = {
      ...(params.status === 'BOOKED' || params.status === 'CANCELLED' || params.status === 'COMPLETED' ? { status: params.status as 'BOOKED' | 'CANCELLED' | 'COMPLETED' } : {}),
      ...(params.programId ? { programId: params.programId } : {}),
      ...(params.coachId ? { coachId: params.coachId } : {}),
      ...(params.when === 'upcoming' ? { startsAt: { gte: now } } : params.when === 'past' ? { startsAt: { lt: now } } : {}),
      ...(params.from && params.to ? { startsAt: { gte: new Date(params.from), lt: new Date(params.to) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.coachingBooking.findMany({ where, orderBy: { startsAt: params.when === 'past' ? 'desc' : 'asc' }, skip: (page - 1) * pageSize, take: params.from ? 500 : pageSize }),
      this.db.coachingBooking.count({ where }),
    ]);
    const [users, programs, sessions] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.userId, r.coachId]))] } }, select: { id: true, fullName: true, email: true } }),
      this.db.coachingProgram.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.programId))] } }, select: { id: true, title: true } }),
      this.db.coachingSession.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.sessionId))] } }, select: { id: true, title: true } }),
    ]);
    const u = (id: string) => users.find((x) => x.id === id);
    return {
      items: rows.map((r) => ({
        id: r.id, startsAt: r.startsAt, endsAt: r.endsAt, status: r.status, meetingUrl: r.meetingUrl, cancelledBy: r.cancelledBy,
        student: { id: r.userId, name: u(r.userId)?.fullName ?? '', email: u(r.userId)?.email ?? '' }, coach: { id: r.coachId, name: u(r.coachId)?.fullName ?? '' },
        program: { id: r.programId, title: programs.find((p) => p.id === r.programId)?.title ?? '' }, session: { id: r.sessionId, title: sessions.find((s) => s.id === r.sessionId)?.title ?? '' },
      })),
      meta: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  private async announce(bookingId: string, what: 'booked' | 'cancelled') {
    const b = await this.db.coachingBooking.findFirstOrThrow({ where: { id: bookingId } });
    const [program, session, student, coach, tenant, profile] = await Promise.all([
      this.db.coachingProgram.findFirstOrThrow({ where: { id: b.programId } }),
      this.db.coachingSession.findFirst({ where: { id: b.sessionId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: b.userId }, select: { fullName: true, email: true, timezone: true } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: b.coachId }, select: { fullName: true, email: true } }),
      this.prisma.tenant.findUniqueOrThrow({ where: { id: this.ctx.requireTenantId() }, select: { name: true, timezone: true } }),
      this.db.coachProfile.findFirst({ where: { userId: b.coachId } }),
    ]);
    const when = (tz: string) => `${new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeStyle: 'short', timeZone: tz }).format(b.startsAt)} (${tz})`;
    const name = `${session?.title ?? 'Session'} · ${program.title}`;
    const studentTz = student.timezone && isTimeZone(student.timezone) ? student.timezone : tenant.timezone;
    const coachTz = profile?.timezone ?? tenant.timezone;
    const verb = what === 'booked' ? 'Booked' : 'Cancelled';
    const link = b.meetingUrl && what === 'booked' ? `<p>Join here: <a href="${escapeHtml(b.meetingUrl)}">${escapeHtml(b.meetingUrl)}</a></p>` : '';
    await this.mail.send({
      to: student.email, tenantId: b.tenantId, tag: `coaching-${what}`,
      subject: `${verb}: ${name}`,
      html: `<p>Hi ${escapeHtml(student.fullName)},</p><p>${what === 'booked' ? 'Your session is booked' : 'Your session was cancelled'}: <strong>${escapeHtml(name)}</strong> with ${escapeHtml(coach.fullName)} on ${escapeHtml(when(studentTz))}.</p>${link}`,
      text: `${what === 'booked' ? 'Your session is booked' : 'Your session was cancelled'}: ${name} with ${coach.fullName} on ${when(studentTz)}.${b.meetingUrl && what === 'booked' ? ` Join: ${b.meetingUrl}` : ''}`,
    });
    await this.mail.send({
      to: coach.email, tenantId: b.tenantId, tag: `coaching-${what}-coach`,
      subject: `${verb}: ${name} with ${student.fullName}`,
      html: `<p>${escapeHtml(student.fullName)} (${escapeHtml(student.email)}) ${what === 'booked' ? 'booked' : 'cancelled'} <strong>${escapeHtml(name)}</strong> on ${escapeHtml(when(coachTz))}.</p>${link}`,
      text: `${student.fullName} (${student.email}) ${what === 'booked' ? 'booked' : 'cancelled'} ${name} on ${when(coachTz)}.`,
    });
    await this.notifications.notify({ userId: b.userId, tenantId: b.tenantId, category: 'live', title: `${verb}: ${session?.title ?? 'coaching session'}`, body: `${program.title} with ${coach.fullName} — ${when(studentTz)}`, link: '/learn/coaching', brand: tenant.name, skipEmail: true });
  }

  // ── public ────────────────────────────────────────────────
  private publicView(v: Awaited<ReturnType<CoachingService['view']>>) {
    return {
      id: v.id, slug: v.slug, title: v.title, description: v.description, faqs: v.faqs, planName: v.planName, priceAmount: v.priceAmount, compareAtAmount: v.compareAtAmount, currency: v.currency, isFree: v.isFree, coverUrl: v.coverUrl,
      coaches: v.coaches.map((c) => ({ name: c.name })),
      sessions: v.sessions.map((s) => ({ title: s.title, durationMin: s.durationMin, agenda: s.agenda })),
    };
  }

  async publicList(apiOrigin: string) {
    const rows = await this.db.coachingProgram.findMany({ where: { status: 'PUBLISHED' }, orderBy: { publishedAt: 'desc' }, take: 100 });
    return Promise.all(rows.map(async (p) => this.publicView(await this.view(p, apiOrigin))));
  }

  async publicGet(slug: string, apiOrigin: string) {
    const p = await this.db.coachingProgram.findFirst({ where: { slug: slug.slice(0, 120), status: 'PUBLISHED' } });
    if (!p) throw AppException.notFound('Coaching program not found');
    return this.publicView(await this.view(p, apiOrigin));
  }

  // ── student ───────────────────────────────────────────────
  async claimFree(userId: string, programId: string) {
    const p = await this.db.coachingProgram.findFirst({ where: { id: programId, status: 'PUBLISHED' } });
    if (!p) throw AppException.notFound('Coaching program not found');
    if (Number(p.priceAmount) > 0) throw AppException.conflict('This program is paid — buy it to book sessions.');
    await this.grant(this.db, userId, programId, 'FREE', null);
    return { claimed: true };
  }

  /** Grants (or restores) access; used by free claims and order fulfilment. */
  async grant(tx: Pick<TenantPrismaClient, 'coachingAccess'>, userId: string, programId: string, source: 'FREE' | 'PURCHASE' | 'MANUAL', orderId: string | null) {
    const existing = await tx.coachingAccess.findFirst({ where: { programId, userId } });
    if (existing) {
      if (existing.revokedAt || (orderId && !existing.orderId)) await tx.coachingAccess.update({ where: { id: existing.id }, data: { revokedAt: null, source, orderId: orderId ?? existing.orderId } });
      return;
    }
    await tx.coachingAccess.create({ data: { programId, userId, source, orderId } as never });
  }

  /** Programs I have, with each session's current booking. */
  async mine(userId: string, apiOrigin: string) {
    const access = await this.db.coachingAccess.findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: 'desc' } });
    const out = [];
    for (const a of access) {
      const p = await this.db.coachingProgram.findFirst({ where: { id: a.programId } });
      if (!p) continue;
      const v = await this.view(p, apiOrigin);
      const bookings = await this.db.coachingBooking.findMany({ where: { accessId: a.id, status: { in: [...LIVE] } } });
      const coachNames = await this.prisma.user.findMany({ where: { id: { in: bookings.map((b) => b.coachId) } }, select: { id: true, fullName: true } });
      out.push({
        id: p.id, title: p.title, slug: p.slug, coverUrl: v.coverUrl, since: a.createdAt,
        sessions: v.sessions.map((s) => {
          const b = bookings.find((x) => x.sessionId === s.id);
          return {
            id: s.id, title: s.title, durationMin: s.durationMin, agenda: s.agenda, notes: s.notes,
            attachments: b ? s.attachments : [],
            booking: b ? { id: b.id, startsAt: b.startsAt, endsAt: b.endsAt, status: b.status, meetingUrl: b.meetingUrl, coachName: coachNames.find((c) => c.id === b.coachId)?.fullName ?? '' } : null,
          };
        }),
      });
    }
    return out;
  }

  /** Signed link to a session attachment, once that session is booked. */
  async attachment(userId: string, bookingId: string, fileId: string, apiOrigin: string) {
    const b = await this.db.coachingBooking.findFirst({ where: { id: bookingId, userId, status: { in: [...LIVE] } } });
    if (!b) throw AppException.notFound('Booking not found');
    const s = await this.db.coachingSession.findFirst({ where: { id: b.sessionId } });
    if (!s || !(s.attachmentIds as string[]).includes(fileId)) throw AppException.notFound('File not found');
    const asset = await this.db.fileAsset.findFirst({ where: { id: fileId } });
    if (!asset || asset.status !== 'READY') throw AppException.notFound('File not available');
    return { url: await this.storage.downloadUrl(asset, asset.fileName, apiOrigin, 600, false), fileName: asset.fileName };
  }
}
