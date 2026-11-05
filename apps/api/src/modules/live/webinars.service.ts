import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { emailTemplates } from '../../core/mail/templates.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { TENANT_PRISMA } from '../../core/tenancy/tenancy.module.js';
import type { TenantPrismaClient } from '../../core/tenancy/tenant-prisma.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { academyOrigin } from '../tenants/academy-origin.js';
import { LiveService } from './live.service.js';
import { LeadsService } from '../marketing/leads.service.js';

const fmt = (d: Date, tz: string) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'full', timeStyle: 'short', timeZone: tz }).format(d);

/** Public webinar pages: registration (free), ticket links and joining without an account. */
@Injectable()
export class WebinarsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly live: LiveService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
    private readonly leads: LeadsService,
  ) {}

  private async webinar(slug: string) {
    const c = await this.db.liveClass.findFirst({ where: { slug, kind: 'WEBINAR', status: 'ACTIVE' }, include: { sessions: { where: { status: { in: ['SCHEDULED', 'LIVE'] } }, orderBy: { startsAt: 'asc' } } } });
    if (!c) throw AppException.notFound('Webinar not found');
    return c;
  }

  async publicGet(slug: string) {
    const c = await this.webinar(slug);
    const count = await this.db.webinarRegistration.count({ where: { liveClassId: c.id } });
    return {
      slug: c.slug, title: c.title, description: c.description, durationMinutes: c.durationMinutes, timezone: c.timezone, provider: c.provider,
      sessions: c.sessions.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status })),
      seatsLeft: c.capacity ? Math.max(0, c.capacity - count) : null, open: c.sessions.length > 0 && (!c.capacity || count < c.capacity),
    };
  }

  async register(slug: string, input: { name: string; email: string; consent: boolean }) {
    const c = await this.webinar(slug);
    if (!c.sessions.length) throw AppException.conflict('There are no upcoming sessions for this webinar.');
    const email = input.email.trim().toLowerCase();
    let reg = await this.db.webinarRegistration.findFirst({ where: { liveClassId: c.id, email } });
    if (!reg) {
      if (c.capacity && (await this.db.webinarRegistration.count({ where: { liveClassId: c.id } })) >= c.capacity) throw AppException.conflict('This webinar is full.');
      const student = await this.prisma.user.findFirst({ where: { tenantId: this.ctx.requireTenantId(), realm: 'TENANT', email }, select: { id: true } });
      try {
        reg = await this.db.webinarRegistration.create({ data: { liveClassId: c.id, name: input.name.trim().slice(0, 120), email, userId: student?.id ?? null, ticketCode: randomBytes(12).toString('base64url'), consent: input.consent } as never });
      } catch (e: any) {
        if (e?.code !== 'P2002') throw e;
        reg = (await this.db.webinarRegistration.findFirst({ where: { liveClassId: c.id, email } }))!;
      }
    }
    await this.leads.capture({ email, name: input.name, source: `webinar:${slug}`.slice(0, 60), consent: input.consent, tags: [`webinar:${slug}`.slice(0, 40)], userId: reg.userId });
    // Always (re)send the ticket — registering again is how people recover a lost link.
    const { origin, name } = await academyOrigin(this.prisma, this.config, this.ctx.requireTenantId());
    const first = c.sessions[0];
    await this.mail.send({
      to: email, tenantId: this.ctx.tenantId, tag: 'webinar-registration',
      ...emailTemplates.billingNotice({
        brand: name, subject: `You're registered: ${c.title}`, heading: "You're registered",
        lines: [`Hi ${reg.name},`, `You're registered for “${c.title}”.`, `Next session: ${fmt(first.startsAt, c.timezone)} (${c.timezone}).`, 'Use your personal link below to join — it opens 15 minutes before the start. Please do not share it.'],
        cta: { label: 'Your join link', url: `${origin}/live/ticket/${reg.ticketCode}` },
      }),
    });
    return { registered: true, email };
  }

  private async byTicket(code: string) {
    const reg = await this.db.webinarRegistration.findFirst({ where: { ticketCode: code } });
    if (!reg) throw AppException.notFound('Ticket not found');
    return reg;
  }

  async ticket(code: string) {
    const reg = await this.byTicket(code);
    const c = await this.db.liveClass.findFirst({ where: { id: reg.liveClassId }, include: { sessions: { where: { status: { in: ['SCHEDULED', 'LIVE'] } }, orderBy: { startsAt: 'asc' } } } });
    if (!c || c.status !== 'ACTIVE') throw AppException.notFound('Webinar not found');
    return { name: reg.name, webinar: { title: c.title, description: c.description, timezone: c.timezone, provider: c.provider }, sessions: c.sessions.map((s) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, status: s.status })) };
  }

  async joinWithTicket(code: string, sessionId: string) {
    const reg = await this.byTicket(code);
    return this.live.join(sessionId, { userId: null, registrationId: reg.id, name: reg.name });
  }

  async who(code: string) {
    const reg = await this.byTicket(code);
    return { userId: null, registrationId: reg.id, staff: false, name: reg.name };
  }
}
