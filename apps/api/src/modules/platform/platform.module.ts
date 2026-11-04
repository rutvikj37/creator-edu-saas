import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformTenantsController } from './platform-tenants.controller.js';
import { PlatformTenantsService } from './platform-tenants.service.js';
import { PlansController } from './plans.controller.js';
import { SettingsController } from './settings.controller.js';
import { AdminsController } from './admins.controller.js';
import { AuditController } from './audit.controller.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { ContentController } from './content.controller.js';
import { CreatorSupportController, PlatformSupportController } from './support.controller.js';
import { SupportService } from './support.service.js';
import { BillingController } from './billing.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [
    PlatformTenantsController, PlansController, SettingsController, AdminsController, AuditController, DashboardController,
    ContentController, CreatorSupportController, PlatformSupportController, BillingController,
  ],
  providers: [PlatformTenantsService, DashboardService, SupportService],
})
export class PlatformModule {}
