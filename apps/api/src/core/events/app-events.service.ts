import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUES } from '../queue/queue.constants.js';

/** Business events other modules can react to (lead capture, automations). */
export interface AppEventMap {
  'student.registered': { tenantId: string; userId: string; email: string; name: string };
  'course.enrolled': { tenantId: string; userId: string; courseId: string; source: string };
  'course.completed': { tenantId: string; userId: string; courseId: string };
  'order.paid': { tenantId: string; userId: string; orderId: string; courseIds: string[]; total: string; currency: string };
  'lead.created': { tenantId: string; leadId: string; email: string; source: string };
}
export type AppEventName = keyof AppEventMap;
export const DOMAIN_EVENT_JOB = 'domain-event';

type Handler<K extends AppEventName> = (payload: AppEventMap[K]) => Promise<unknown> | unknown;

/**
 * emit() runs in-process listeners (failures are logged, never break the caller) and queues the
 * event for the worker (automations). Events are facts: emit after the change has committed.
 */
@Injectable()
export class AppEvents {
  private readonly logger = new Logger(AppEvents.name);
  private readonly handlers = new Map<AppEventName, Handler<any>[]>();

  constructor(@InjectQueue(QUEUES.MARKETING) private readonly queue: Queue) {}

  on<K extends AppEventName>(name: K, handler: Handler<K>) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
  }

  async emit<K extends AppEventName>(name: K, payload: AppEventMap[K]) {
    for (const h of this.handlers.get(name) ?? []) {
      try {
        await h(payload);
      } catch (e) {
        this.logger.error({ event: name, err: (e as Error).message }, 'event listener failed');
      }
    }
    try {
      await this.queue.add(DOMAIN_EVENT_JOB, { name, payload, at: new Date().toISOString() }, { removeOnComplete: 1000 });
    } catch (e) {
      this.logger.error({ event: name, err: (e as Error).message }, 'could not queue event');
    }
  }
}

@Global()
@Module({ providers: [AppEvents], exports: [AppEvents] })
export class AppEventsModule {}
