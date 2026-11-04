import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CLS_BYPASS_TENANT, CLS_TENANT_ID } from './request-context.js';

/** Request-scoped tenant id (AsyncLocalStorage). Set only by guards/processors, never from client input. */
@Injectable()
export class TenantContext {
  constructor(private readonly cls: ClsService) {}

  get tenantId(): string | undefined {
    return this.cls.isActive() ? this.cls.get(CLS_TENANT_ID) : undefined;
  }

  requireTenantId(): string {
    const id = this.tenantId;
    if (!id) throw new Error('Tenant context is not set');
    return id;
  }

  set(tenantId: string) {
    this.cls.set(CLS_TENANT_ID, tenantId);
  }

  /** Runs fn with a tenant context (background jobs, scripts). */
  run<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return this.cls.run(async () => {
      this.cls.set(CLS_TENANT_ID, tenantId);
      return fn();
    });
  }

  /** Explicit, auditable cross-tenant access for platform administration only. */
  runAsPlatform<T>(fn: () => Promise<T>): Promise<T> {
    return this.cls.run(async () => {
      this.cls.set(CLS_BYPASS_TENANT, true);
      return fn();
    });
  }

  get bypass(): boolean {
    return this.cls.isActive() && this.cls.get(CLS_BYPASS_TENANT) === true;
  }
}
