import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { PaginationQueryDto } from '../../common/dto/pagination.dto.js';
import type { AppRequest, AuthContext } from '../../core/tenancy/request-context.js';
import { apiOrigin } from '../files/files.controller.js';
import { QuizzesService } from '../assessment/quizzes.service.js';
import { AssignmentsService } from '../assessment/assignments.service.js';
import { AssignmentSettingsDto, GradeSubmissionDto, ManualGradeDto, OrderDto, QuestionDto, QuizSettingsDto } from '../assessment/dto.js';
import { CertificatesService } from '../certificates/certificates.service.js';
import { CreatorLearningService } from './creator-learning.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
class EnrollDto { @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail({}, { message: 'Enter a valid email address' }) email: string; }
class ReplyDto { @ApiProperty() @Transform(trim) @IsString() @Length(1, 5000) body: string; }
class ModerateDto { @ApiProperty({ enum: ['hide', 'resolve', 'reopen'] }) @IsIn(['hide', 'resolve', 'reopen']) action: 'hide' | 'resolve' | 'reopen'; }
class TemplateDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(3, 120) title?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(3, 300) bodyText?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) signatoryName?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) signatoryRole?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) accentColor?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showQr?: boolean;
}
class RevokeDto { @ApiProperty() @Transform(trim) @IsString() @Length(3, 255) reason: string; }

@ApiTags('Creator · Learning')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator', version: '1' })
export class CreatorLearningController {
  constructor(
    private readonly svc: CreatorLearningService,
    private readonly quizzes: QuizzesService,
    private readonly assignments: AssignmentsService,
    private readonly certificates: CertificatesService,
  ) {}

  @Get('students') @RequirePermissions(PERMISSIONS.STUDENTS_READ)
  students(@Query() q: PaginationQueryDto) { return this.svc.students(q); }

  @Get('students/:id') @RequirePermissions(PERMISSIONS.STUDENTS_READ)
  student(@Param('id') id: string) { return this.svc.student(id); }

  @Get('courses/:id/enrollments') @RequirePermissions(PERMISSIONS.STUDENTS_READ)
  enrollments(@Param('id') id: string) { return this.svc.courseEnrollments(id); }

  @Post('courses/:id/enrollments') @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  enroll(@Param('id') id: string, @Body() dto: EnrollDto, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    const tenantHost = req.get('origin') ?? apiOrigin(req);
    return this.svc.enroll(id, dto.email, auth.userId, tenantHost);
  }

  @Delete('enrollments/:enrollmentId') @RequirePermissions(PERMISSIONS.STUDENTS_MANAGE)
  revoke(@Param('enrollmentId') id: string, @CurrentAuth() auth: AuthContext) { return this.svc.revoke(id, auth.userId); }

  @Get('discussions') @RequirePermissions(PERMISSIONS.COURSES_READ)
  discussions(@Query('unanswered') unanswered?: string, @Query('courseId') courseId?: string) { return this.svc.discussions({ unanswered: unanswered === 'true', courseId }); }

  @Post('discussions/:id/replies') @RequirePermissions(PERMISSIONS.COMMUNITY_MANAGE)
  reply(@Param('id') id: string, @Body() dto: ReplyDto, @CurrentAuth() auth: AuthContext) { return this.svc.reply(id, dto.body, auth.userId); }

  @Post('discussions/:id/moderate') @HttpCode(200) @RequirePermissions(PERMISSIONS.COMMUNITY_MANAGE)
  moderate(@Param('id') id: string, @Body() dto: ModerateDto, @CurrentAuth() auth: AuthContext) { return this.svc.moderate(id, dto.action, auth.userId); }

  // quiz builder
  @Get('courses/:id/lessons/:lessonId/quiz') @RequirePermissions(PERMISSIONS.COURSES_READ)
  quiz(@Param('id') id: string, @Param('lessonId') l: string) { return this.quizzes.forLesson(id, l); }

  @Put('courses/:id/lessons/:lessonId/quiz') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  quizSettings(@Param('id') id: string, @Param('lessonId') l: string, @Body() dto: QuizSettingsDto) { return this.quizzes.updateSettings(id, l, dto); }

  @Post('courses/:id/lessons/:lessonId/quiz/questions') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  addQuestion(@Param('id') id: string, @Param('lessonId') l: string, @Body() dto: QuestionDto) { return this.quizzes.addQuestion(id, l, dto); }

  @Put('courses/:id/lessons/:lessonId/quiz/questions/order') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  orderQuestions(@Param('id') id: string, @Param('lessonId') l: string, @Body() dto: OrderDto) { return this.quizzes.reorder(id, l, dto.ids); }

  @Put('courses/:id/lessons/:lessonId/quiz/questions/:qid') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  updateQuestion(@Param('id') id: string, @Param('lessonId') l: string, @Param('qid') q: string, @Body() dto: QuestionDto) { return this.quizzes.updateQuestion(id, l, q, dto); }

  @Delete('courses/:id/lessons/:lessonId/quiz/questions/:qid') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  removeQuestion(@Param('id') id: string, @Param('lessonId') l: string, @Param('qid') q: string) { return this.quizzes.removeQuestion(id, l, q); }

  @Get('quizzes/:quizId/attempts') @RequirePermissions(PERMISSIONS.ASSESSMENTS_GRADE)
  attempts(@Param('quizId') id: string) { return this.quizzes.attemptsForQuiz(id); }

  @Get('quiz-attempts/:attemptId') @RequirePermissions(PERMISSIONS.ASSESSMENTS_GRADE)
  attemptDetail(@Param('attemptId') id: string) { return this.quizzes.attemptForInstructor(id); }

  @Post('quiz-attempts/:attemptId/grade') @HttpCode(200) @RequirePermissions(PERMISSIONS.ASSESSMENTS_GRADE)
  gradeAttempt(@Param('attemptId') id: string, @Body() dto: ManualGradeDto, @CurrentAuth() auth: AuthContext) { return this.quizzes.grade(id, dto, auth.userId); }

  // assignments
  @Get('courses/:id/lessons/:lessonId/assignment') @RequirePermissions(PERMISSIONS.COURSES_READ)
  assignment(@Param('id') id: string, @Param('lessonId') l: string) { return this.assignments.forLesson(id, l); }

  @Put('courses/:id/lessons/:lessonId/assignment') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  assignmentSettings(@Param('id') id: string, @Param('lessonId') l: string, @Body() dto: AssignmentSettingsDto) { return this.assignments.update(id, l, dto); }

  @Get('assignments/:assignmentId/submissions') @RequirePermissions(PERMISSIONS.ASSESSMENTS_GRADE)
  submissions(@Param('assignmentId') id: string, @Req() req: AppRequest) { return this.assignments.submissions(id, apiOrigin(req)); }

  @Post('submissions/:submissionId/grade') @HttpCode(200) @RequirePermissions(PERMISSIONS.ASSESSMENTS_GRADE)
  gradeSubmission(@Param('submissionId') id: string, @Body() dto: GradeSubmissionDto, @CurrentAuth() auth: AuthContext) { return this.assignments.grade(id, dto, auth.userId); }

  // certificates
  @Get('certificates/template') @RequirePermissions(PERMISSIONS.CERTIFICATES_MANAGE)
  template() { return this.certificates.template(); }

  @Put('certificates/template') @RequirePermissions(PERMISSIONS.CERTIFICATES_MANAGE)
  updateTemplate(@Body() dto: TemplateDto, @CurrentAuth() auth: AuthContext) { return this.certificates.updateTemplate(dto, auth.userId); }

  @Get('certificates') @RequirePermissions(PERMISSIONS.CERTIFICATES_MANAGE)
  certificatesList(@Query('courseId') courseId?: string) { return this.certificates.listForCreator({ courseId }); }

  @Post('certificates/:id/revoke') @HttpCode(200) @RequirePermissions(PERMISSIONS.CERTIFICATES_MANAGE)
  revokeCertificate(@Param('id') id: string, @Body() dto: RevokeDto, @CurrentAuth() auth: AuthContext) { return this.certificates.revoke(id, dto.reason, auth.userId); }

  @Post('certificates/:id/reinstate') @HttpCode(200) @RequirePermissions(PERMISSIONS.CERTIFICATES_MANAGE)
  reinstateCertificate(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.certificates.reinstate(id, auth.userId); }
}
