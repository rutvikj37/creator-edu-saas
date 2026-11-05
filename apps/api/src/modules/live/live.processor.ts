import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { AppConfig } from '../../config/app-config.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { emailTemplates } from '../../core/mail/templates.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { QUEUES } from '../../core/queue/queue.constants.js';
import { REDIS_CLIENT } from '../../core/redis/redis.constants.js';
import { TenantContext } from '../../core/tenancy/tenant-context.service.js';
import { academyOrigin } from '../tenants/academy-origin.js';
import { LiveService } from './live.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { LiveRecordingsService } from './live-recordings.service.js';
import { PlugNmeetService } from './plugnmeet.service.js';

export const LIVE_JOBS = { REMINDERS: 'live-reminders', MAINTAIN: 'live-maintain', PNM_SYNC: 'live-plugnmeet-sync', PNM_IMPORT: 'live-plugnmeet-import' } as const;
const REMINDERS = [
  { key: '24h', ms: 24 * 3600_000, label: 'tomorrow' },
  { key: '1h', ms: 3600_000, label: 'in 1 hour' },
  { key: '10m', ms: 10 * 60_000, label: 'in 10 minutes' },
];

/** Reminder emails, recurring-session materialisation and closing sessions nobody ended. */
@Injectable()
export class LiveJobs {
  private readonly logger = new Logger(LiveJobs.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly live: LiveService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly notifications: NotificationsService,
  ) {}

  async sendReminders(now = new Date()) {
    let sent = 0;
    for (const r of REMINDERS) {
      // Window of 2 minutes (job runs every minute) so a slow tick never skips a session.
      const sessions = await this.prisma.liveSession.findMany({
        where: { status: 'SCHEDULED', startsAt: { gt: new Date(now.getTime() + r.ms - 2 * 60_000), lte: new Date(now.getTime() + r.ms) }, liveClass: { status: 'ACTIVE' } },
        include: { liveClass: true }, take: 500,
      });
      for (const s of sessions) {
        if (!(await this.redis.set(`live:remind:${s.id}:${r.key}`, '1', 'EX', 3 * 86_400, 'NX'))) continue;
        await this.ctx.run(s.tenantId, async () => {
          const people = await this.live.audienceEmails(s.liveClass);
          const { origin, name } = await academyOrigin(this.prisma, this.config, s.tenantId);
          const when = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: s.liveClass.timezone }).format(s.startsAt);
          for (const p of people) {
            if (p.userId) {
              await this.notifications.notify({ userId: p.userId, tenantId: s.tenantId, category: 'live', title: `Starting ${r.label}: ${s.liveClass.title}`, body: `“${s.liveClass.title}” starts ${when} (${s.liveClass.timezone}).`, link: '/learn/live', url: `${origin}/learn/live`, brand: name });
              sent++;
              continue;
            }
            await this.mail.send({
              to: p.email, tenantId: s.tenantId, tag: `live-reminder-${r.key}`,
              ...emailTemplates.billingNotice({
                brand: name, subject: `Starting ${r.label}: ${s.liveClass.title}`, heading: `${s.liveClass.title} starts ${r.label}`,
                lines: [`Hi ${p.name},`, `“${s.liveClass.title}” starts ${when} (${s.liveClass.timezone}).`, s.liveClass.kind === 'WEBINAR' ? 'Use the personal join link from your registration email.' : 'Join from the Live classes page of your academy.'],
                cta: s.liveClass.kind === 'WEBINAR' ? undefined : { label: 'Open live classes', url: `${origin}/learn/live` },
              }),
            });
            sent++;
          }
        });
      }
    }
    return sent;
  }

  async maintain(now = new Date()) {
    let created = 0;
    const recurring = await this.prisma.liveClass.findMany({ where: { status: 'ACTIVE', recurrence: { not: Prisma.DbNull } }, select: { id: true, tenantId: true, recurrence: true } });
    for (const c of recurring) {
      if (!c.recurrence) continue;
      created += await this.ctx.run(c.tenantId, () => this.live.materialize(c.id));
    }
    // Sessions left LIVE long after their end (host closed the tab) are ended so attendance is final.
    const stale = await this.prisma.liveSession.findMany({ where: { status: 'LIVE', endsAt: { lt: new Date(now.getTime() - 3 * 3600_000) } }, select: { id: true, tenantId: true }, take: 200 });
    for (const s of stale) await this.ctx.run(s.tenantId, () => this.live.end(s.id, 'system'));
    return { created, ended: stale.length };
  }
}

/** plugNmeet: attendance/room reconciliation for running sessions and recording imports. */
@Injectable()
export class PlugNmeetJobs {
  private readonly logger = new Logger(PlugNmeetJobs.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly live: LiveService,
    private readonly pnm: PlugNmeetService,
    private readonly recordings: LiveRecordingsService,
    @InjectQueue(QUEUES.LIVE) private readonly queue: Queue,
  ) {}

  async sync(now = new Date()) {
    if (!this.pnm.isConfigured()) return { synced: 0, queued: 0 };
    const running = await this.prisma.liveSession.findMany({ where: { status: 'LIVE', liveClass: { provider: 'PLUGNMEET' } }, select: { id: true, tenantId: true }, take: 200 });
    let synced = 0;
    for (const s of running) {
      await this.ctx.run(s.tenantId, () => this.live.syncPlugNmeetSession(s.id, now)).then(() => synced++, (e) => this.logger.warn(`plugNmeet sync ${s.id}: ${(e as Error).message}`));
    }
    const rows = await this.recordings.discover(now);
    for (const id of rows) await this.queue.add(LIVE_JOBS.PNM_IMPORT, { id }, { jobId: `pnm-import-${id}`, attempts: 5, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 1000, removeOnFail: 1000 });
    return { synced, queued: rows.length };
  }

  importRecording(job: Job<{ id: string }>) {
    return this.recordings.import(job.data.id, job.attemptsMade + 1 >= (job.opts.attempts ?? 1));
  }
}

@Processor(QUEUES.LIVE)
export class LiveProcessor extends WorkerHost {
  constructor(private readonly jobs: LiveJobs, private readonly pnmJobs: PlugNmeetJobs) {
    super();
  }
  async process(job: Job) {
    if (job.name === LIVE_JOBS.REMINDERS) return this.jobs.sendReminders();
    if (job.name === LIVE_JOBS.MAINTAIN) return this.jobs.maintain();
    if (job.name === LIVE_JOBS.PNM_SYNC) return this.pnmJobs.sync();
    if (job.name === LIVE_JOBS.PNM_IMPORT) return this.pnmJobs.importRecording(job as Job<{ id: string }>);
    throw new Error(`Unknown live job: ${job.name}`);
  }
}

@Injectable()
export class LiveScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.LIVE) private readonly queue: Queue) {}
  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(LIVE_JOBS.REMINDERS, { every: 60_000 }, { name: LIVE_JOBS.REMINDERS });
    await this.queue.upsertJobScheduler(LIVE_JOBS.MAINTAIN, { every: 30 * 60_000 }, { name: LIVE_JOBS.MAINTAIN });
    await this.queue.upsertJobScheduler(LIVE_JOBS.PNM_SYNC, { every: 60_000 }, { name: LIVE_JOBS.PNM_SYNC });
  }
}
