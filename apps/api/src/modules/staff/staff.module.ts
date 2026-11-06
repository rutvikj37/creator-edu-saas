import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InvitationsController, RolesController, StaffController } from './staff.controller.js';
import { RolesService } from './roles.service.js';
import { StaffService } from './staff.service.js';

@Module({ imports: [AuthModule], controllers: [StaffController, InvitationsController, RolesController], providers: [StaffService, RolesService] })
export class StaffModule {}
