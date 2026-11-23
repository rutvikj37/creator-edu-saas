import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

/**
 * Makes values JSON-safe: BigInt becomes a string (JSON.stringify throws on it). Anything with its
 * own toJSON (Date, Prisma.Decimal → string) is left for JSON.stringify, so money stays a string.
 */
export function normalizeSerialization<T>(val: T): T {
  if (val === null || val === undefined) return val;
  if (typeof val === 'bigint') return val.toString() as unknown as T;
  if (typeof val !== 'object') return val;
  if (typeof (val as { toJSON?: unknown }).toJSON === 'function' || Buffer.isBuffer(val)) return val;
  if (Array.isArray(val)) return val.map(normalizeSerialization) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val)) out[k] = normalizeSerialization(v);
  return out as T;
}

/** Marker type: services return this to include pagination/meta alongside data. */
export class Paginated<T> {
  constructor(
    public readonly items: T[],
    public readonly meta: { page: number; pageSize: number; total: number },
  ) {}
}

/** Wraps successful responses as `{ success: true, data, meta? }`. */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value) => {
        if (value instanceof StreamableFile) return value;
        if (value instanceof Paginated) return { success: true, data: normalizeSerialization(value.items), meta: value.meta };
        return { success: true, data: normalizeSerialization(value ?? null) };
      }),
    );
  }
}
