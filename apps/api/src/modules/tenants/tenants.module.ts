import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TenantsService } from './tenants.service.js';
import { DomainsService } from './domains.service.js';
import { DnsVerifier } from './dns-verifier.js';
import { WorkspaceController } from './workspace.controller.js';
import { AcademyPublicController } from './academy-public.controller.js';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [WorkspaceController, AcademyPublicController],
  providers: [TenantsService, DomainsService, DnsVerifier],
  exports: [TenantsService],
})
export class TenantsModule {}
