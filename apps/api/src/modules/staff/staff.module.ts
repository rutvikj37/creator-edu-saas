import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InvitationsController, StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';

@Module({ imports: [AuthModule], controllers: [StaffController, InvitationsController], providers: [StaffService] })
export class StaffModule {}
