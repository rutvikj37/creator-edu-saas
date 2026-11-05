import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { AiService } from './ai.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class OutlineDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(25, 25) courseId?: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 1000) topic: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(300) audience?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['Beginner', 'Intermediate', 'Advanced']) level?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(12) sections?: number;
}
class OutlineLessonDto {
  @Transform(trim) @IsString() @Length(1, 200) title: string;
  @IsOptional() @IsString() @MaxLength(1000) summary: string = '';
}
class OutlineSectionDto {
  @Transform(trim) @IsString() @Length(1, 200) title: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(15) @ValidateNested({ each: true }) @Type(() => OutlineLessonDto) lessons: OutlineLessonDto[];
}
class ApplyOutlineDto {
  @ApiProperty() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => OutlineSectionDto) sections: OutlineSectionDto[];
}
class LessonDraftDto {
  @ApiProperty() @IsString() @Length(25, 25) courseId: string;
  @ApiProperty() @IsString() @Length(25, 25) lessonId: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) notes?: string;
}
class QuizGenDto {
  @ApiProperty() @IsString() @Length(25, 25) courseId: string;
  @ApiProperty() @IsString() @Length(25, 25) sourceLessonId: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10) count?: number;
}
class TutorSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(200) dailyLimit?: number;
}
class TurnDto {
  @IsIn(['user', 'assistant']) role: 'user' | 'assistant';
  @IsString() @MaxLength(4000) content: string;
}
class TutorDto {
  @ApiProperty() @IsString() @Length(25, 25) lessonId: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 2000) question: string;
  @ApiPropertyOptional({ type: [TurnDto] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => TurnDto) history?: TurnDto[];
}

@ApiTags('Creator · AI')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/ai', version: '1' })
export class CreatorAiController {
  constructor(private readonly svc: AiService) {}

  @Get('usage') @RequirePermissions(PERMISSIONS.COURSES_READ)
  usage() { return this.svc.usage(); }

  @Get('settings') @RequirePermissions(PERMISSIONS.COURSES_READ)
  settings() { return this.svc.tutorSettings(); }

  @Put('settings') @RequirePermissions(PERMISSIONS.ACADEMY_MANAGE)
  saveSettings(@Body() dto: TutorSettingsDto) { return this.svc.saveTutorSettings(dto); }

  @Post('course-outline') @HttpCode(200) @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  outline(@Body() dto: OutlineDto, @CurrentAuth() a: AuthContext) { return this.svc.courseOutline(a.userId, dto); }

  @Post('courses/:id/apply-outline') @HttpCode(200) @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  apply(@Param('id') id: string, @Body() dto: ApplyOutlineDto) { return this.svc.applyOutline(id, dto as never); }

  @Post('lesson-draft') @HttpCode(200) @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  draft(@Body() dto: LessonDraftDto, @CurrentAuth() a: AuthContext) { return this.svc.lessonDraft(a.userId, dto); }

  @Post('quiz-questions') @HttpCode(200) @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  quiz(@Body() dto: QuizGenDto, @CurrentAuth() a: AuthContext) { return this.svc.quizQuestions(a.userId, dto); }
}

@ApiTags('Learn · AI')
@ApiBearerAuth()
@RequireRealm('TENANT')
@TenantScoped('academy')
@Controller({ path: 'learn/ai', version: '1' })
export class LearnAiController {
  constructor(private readonly svc: AiService) {}

  @Get('tutor')
  status(@CurrentAuth() a: AuthContext) { return this.svc.tutorStatus(a.userId); }

  @Post('tutor') @HttpCode(200)
  ask(@Body() dto: TutorDto, @CurrentAuth() a: AuthContext) { return this.svc.tutor(a.userId, dto); }
}
