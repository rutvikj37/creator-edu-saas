import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service.js';
import { DomainsService } from './domains.service.js';
import { DnsVerifier } from './dns-verifier.js';
import { WorkspaceController } from './workspace.controller.js';
import { AcademyPublicController } from './academy-public.controller.js';

@Module({
  controllers: [WorkspaceController, AcademyPublicController],
  providers: [TenantsService, DomainsService, DnsVerifier],
  exports: [TenantsService],
})
export class TenantsModule {}
