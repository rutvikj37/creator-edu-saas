import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

export interface AuditEntry {
  action: string;
  tenantId?: string | null;
  actorUserId?: string | null;
  actorRealm?: string | null;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

const SENSITIVE_KEYS = /pass(word)?|secret|token|apikey|api_key|credential|otp|hash/i;

/** Recursively replaces sensitive fields so audit snapshots never store secrets. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      SENSITIVE_KEYS.test(k) ? '[REDACTED]' : redact(v, depth + 1),
    ]),
  );
}

/** Append-only audit trail writer. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        action: entry.action,
        tenantId: entry.tenantId ?? null,
        actorUserId: entry.actorUserId ?? null,
        actorRealm: entry.actorRealm ?? null,
        targetType: entry.targetType,
        targetId: entry.targetId,
        before: entry.before === undefined ? undefined : (redact(entry.before) as Prisma.InputJsonValue),
        after: entry.after === undefined ? undefined : (redact(entry.after) as Prisma.InputJsonValue),
        ip: entry.ip?.slice(0, 45),
        userAgent: entry.userAgent?.slice(0, 512),
        requestId: entry.requestId,
      },
    });
    this.logger.debug({ action: entry.action, targetId: entry.targetId }, 'audit');
  }
}
