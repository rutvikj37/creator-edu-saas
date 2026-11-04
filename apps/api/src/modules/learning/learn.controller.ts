import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { CurrentAuth, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import type { AppRequest, AuthContext } from '../../core/tenancy/request-context.js';
import { apiOrigin, BeginUploadDto } from '../files/files.controller.js';
import { FilesService } from '../files/files.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { CertificatesService } from '../certificates/certificates.service.js';
import { QuizzesService } from '../assessment/quizzes.service.js';
import { AssignmentsService } from '../assessment/assignments.service.js';
import { AnswerDto, SubmitAssignmentDto } from '../assessment/dto.js';
import { LearningService } from './learning.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
class PositionDto { @ApiProperty() @IsInt() @Min(0) @Max(864000) positionSeconds: number; }
class NoteDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 5000) body: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) positionSeconds?: number;
}
class CommentDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 5000) body: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) parentId?: string;
}

/** Student learning API on the academy host. */
@ApiTags('Student · Learning')
@ApiBearerAuth()
@RequireRealm('TENANT')
@TenantScoped('academy')
@Controller({ path: 'learn', version: '1' })
export class LearnController {
  constructor(
    private readonly learning: LearningService,
    private readonly quizzes: QuizzesService,
    private readonly assignments: AssignmentsService,
    private readonly certificates: CertificatesService,
    private readonly files: FilesService,
  ) {}

  @Get('enrollments')
  enrollments(@CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.learning.myEnrollments(auth.userId, apiOrigin(req));
  }

  @Post('courses/:courseId/enroll')
  @ApiOperation({ summary: 'Enrol in a free course (paid courses go through checkout)' })
  enroll(@Param('courseId') courseId: string, @CurrentAuth() auth: AuthContext) {
    return this.learning.enrollFree(auth.userId, courseId);
  }

  @Get('courses/:courseId/player')
  player(@Param('courseId') courseId: string, @CurrentAuth() auth: AuthContext) {
    return this.learning.player(auth.userId, courseId);
  }

  @Get('courses/:courseId/notes')
  notes(@Param('courseId') courseId: string, @CurrentAuth() auth: AuthContext) {
    return this.learning.notes(auth.userId, courseId);
  }

  @Get('lessons/:lessonId')
  lesson(@Param('lessonId') id: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.learning.lessonContent(auth.userId, id, apiOrigin(req));
  }

  @Put('lessons/:lessonId/position')
  position(@Param('lessonId') id: string, @Body() dto: PositionDto, @CurrentAuth() auth: AuthContext) {
    return this.learning.savePosition(auth.userId, id, dto.positionSeconds);
  }

  @Post('lessons/:lessonId/complete')
  @HttpCode(200)
  complete(@Param('lessonId') id: string, @CurrentAuth() auth: AuthContext) {
    return this.learning.complete(auth.userId, id);
  }

  @Delete('lessons/:lessonId/complete')
  uncomplete(@Param('lessonId') id: string, @CurrentAuth() auth: AuthContext) {
    return this.learning.uncomplete(auth.userId, id);
  }

  @Post('lessons/:lessonId/bookmark')
  @HttpCode(200)
  bookmark(@Param('lessonId') id: string, @CurrentAuth() auth: AuthContext) {
    return this.learning.toggleBookmark(auth.userId, id);
  }

  @Post('lessons/:lessonId/notes')
  addNote(@Param('lessonId') id: string, @Body() dto: NoteDto, @CurrentAuth() auth: AuthContext) {
    return this.learning.addNote(auth.userId, id, dto.body, dto.positionSeconds);
  }

  @Patch('notes/:noteId')
  updateNote(@Param('noteId') id: string, @Body() dto: NoteDto, @CurrentAuth() auth: AuthContext) {
    return this.learning.updateNote(auth.userId, id, dto.body);
  }

  @Delete('notes/:noteId')
  deleteNote(@Param('noteId') id: string, @CurrentAuth() auth: AuthContext) {
    return this.learning.deleteNote(auth.userId, id);
  }

  @Get('lessons/:lessonId/comments')
  async comments(@Param('lessonId') id: string, @CurrentAuth() auth: AuthContext) {
    await this.learning.accessibleLesson(auth.userId, id);
    return this.learning.comments(id);
  }

  @Post('lessons/:lessonId/comments')
  comment(@Param('lessonId') id: string, @Body() dto: CommentDto, @CurrentAuth() auth: AuthContext) {
    return this.learning.addComment(auth.userId, id, dto.body, dto.parentId);
  }

  // quizzes
  @Get('lessons/:lessonId/quiz')
  quiz(@Param('lessonId') id: string, @CurrentAuth() auth: AuthContext) {
    return this.quizzes.overview(auth.userId, id);
  }

  @Post('lessons/:lessonId/quiz/attempts')
  startQuiz(@Param('lessonId') id: string, @CurrentAuth() auth: AuthContext) {
    return this.quizzes.start(auth.userId, id);
  }

  @Get('quiz-attempts/:attemptId')
  attempt(@Param('attemptId') id: string, @CurrentAuth() auth: AuthContext) {
    return this.quizzes.attempt(auth.userId, id);
  }

  @Put('quiz-attempts/:attemptId/answers')
  answer(@Param('attemptId') id: string, @Body() dto: AnswerDto, @CurrentAuth() auth: AuthContext) {
    return this.quizzes.saveAnswer(auth.userId, id, dto);
  }

  @Post('quiz-attempts/:attemptId/submit')
  @HttpCode(200)
  submitQuiz(@Param('attemptId') id: string, @CurrentAuth() auth: AuthContext) {
    return this.quizzes.submit(auth.userId, id);
  }

  // assignments
  @Get('lessons/:lessonId/assignment')
  assignment(@Param('lessonId') id: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.assignments.forStudent(auth.userId, id, apiOrigin(req));
  }

  @Post('lessons/:lessonId/assignment/submission')
  submit(@Param('lessonId') id: string, @Body() dto: SubmitAssignmentDto, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.assignments.submit(auth.userId, id, dto, apiOrigin(req));
  }

  @Post('files')
  @ApiOperation({ summary: 'Upload a file for an assignment or quiz answer' })
  upload(@Body() dto: BeginUploadDto, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    if (dto.purpose !== 'SUBMISSION') throw AppException.validation([{ field: 'purpose', message: 'Students can only upload submissions' }]);
    return this.files.begin({ ...dto, ownerUserId: auth.userId, apiOrigin: apiOrigin(req) });
  }

  @Post('files/:id/complete')
  @HttpCode(200)
  async completeUpload(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    await this.files.assertOwnedBy(id, auth.userId);
    return this.files.complete(id, apiOrigin(req));
  }

  // certificates
  @Get('certificates')
  certificatesList(@CurrentAuth() auth: AuthContext) {
    return this.certificates.listForStudent(auth.userId);
  }

  @Get('certificates/:id/pdf')
  async certificatePdf(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @Res() res: Response) {
    const { bytes, fileName } = await this.certificates.pdf(id, auth.userId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(Buffer.from(bytes));
  }
}
