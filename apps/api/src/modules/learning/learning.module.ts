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
import { ReviewsService } from './reviews.service.js';
import { CreatorReviewsController, LearnReviewsController, PublicReviewsController } from './reviews.controller.js';

@Module({
  controllers: [CatalogController, LearnController, CreatorLearningController, PublicCertificatesController, LearnReviewsController, PublicReviewsController, CreatorReviewsController],
  providers: [ReviewsService, LearningService, CreatorLearningService, QuizzesService, AssignmentsService, CertificatesService],
  exports: [LearningService, ReviewsService],
})
export class LearningModule {}
