import { Module } from '@nestjs/common';
import { CommunitiesService } from './communities.service.js';
import { CreatorCommunitiesController, LearnCommunitiesController } from './communities.controller.js';

@Module({ controllers: [CreatorCommunitiesController, LearnCommunitiesController], providers: [CommunitiesService] })
export class CommunitiesModule {}
