import { Module } from '@nestjs/common';
import { LearningService } from './learning.service.js';
import { CreatorLearningService } from './creator-learning.service.js';
import { CatalogController } from './catalog.controller.js';
import { LearnController } from './learn.controller.js';
import { CreatorLearningController } from './creator-learning.controller.js';
import { QuizzesService } from '../assessment/quizzes.service.js';
import { AssignmentsService } from '../assessment/assignments.service.js';
import { CertificatesService } from '../certificates/certificates.service.js';
import { PublicCertificatesController } from '../certificates/public-certificates.controller.js';

@Module({
  controllers: [CatalogController, LearnController, CreatorLearningController, PublicCertificatesController],
  providers: [LearningService, CreatorLearningService, QuizzesService, AssignmentsService, CertificatesService],
  exports: [LearningService],
})
export class LearningModule {}
