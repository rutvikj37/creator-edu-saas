import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

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
        if (value instanceof Paginated) return { success: true, data: value.items, meta: value.meta };
        return { success: true, data: value ?? null };
      }),
    );
  }
}
