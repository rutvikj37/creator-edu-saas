import { Global, Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { HostResolverService } from './host-resolver.service.js';
import { TenantContext } from './tenant-context.service.js';
import { createTenantPrisma } from './tenant-prisma.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const TENANT_PRISMA = Symbol('TENANT_PRISMA');

@Global()
@Module({
  imports: [ClsModule.forRoot({ global: true, middleware: { mount: true } })],
  providers: [
    HostResolverService,
    TenantContext,
    { provide: TENANT_PRISMA, inject: [PrismaService, TenantContext], useFactory: createTenantPrisma },
  ],
  exports: [HostResolverService, TenantContext, TENANT_PRISMA],
})
export class TenancyModule {}
