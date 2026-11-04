import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { Public } from '../../common/decorators/public.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../core/redis/redis.constants.js';
import { QUEUES } from '../../core/queue/queue.constants.js';

@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue(QUEUES.MAINTENANCE) private readonly maintenanceQueue: Queue,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe (process is running)' })
  live() {
    return { status: 'ok' };
  }

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness: database, Redis and queue connectivity' })
  check() {
    return this.health.check([
      async () => {
        const s = this.indicator.check('database');
        try {
          const started = Date.now();
          await this.prisma.$queryRaw`SELECT 1`;
          return s.up({ latencyMs: Date.now() - started });
        } catch {
          return s.down({ message: 'unreachable' });
        }
      },
      async () => {
        const s = this.indicator.check('redis');
        try {
          const started = Date.now();
          const pong = await this.redis.ping();
          return pong === 'PONG' ? s.up({ latencyMs: Date.now() - started }) : s.down({ message: 'bad reply' });
        } catch {
          return s.down({ message: 'unreachable' });
        }
      },
      async () => {
        const s = this.indicator.check('queue');
        try {
          const counts = await this.maintenanceQueue.getJobCounts('waiting', 'active', 'failed');
          return s.up(counts);
        } catch {
          return s.down({ message: 'unreachable' });
        }
      },
    ]);
  }
}
