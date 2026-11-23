import { Global, Module } from '@nestjs/common';
import { CreatorMembershipsController, MembershipsPublicController } from './memberships.controller.js';
import { MembershipsService } from './memberships.service.js';
import { FilesModule } from '../files/files.module.js';

@Global()
@Module({ imports: [FilesModule], controllers: [CreatorMembershipsController, MembershipsPublicController], providers: [MembershipsService], exports: [MembershipsService] })
export class MembershipsModule {}

@Global()
@Module({ providers: [MembershipsService], exports: [MembershipsService] })
export class MembershipsWorkerModule {}
