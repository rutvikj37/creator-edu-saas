import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, TenantScoped } from '../../common/decorators/auth.decorators.js';
import type { AuthContext } from '../../core/tenancy/request-context.js';
import { QuestionDto, QUESTION_TYPES } from './dto.js';
import { QuestionBankService } from './question-bank.service.js';

class BankQuestionDto extends QuestionDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
}
class BankListQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() @MaxLength(40) tag?: string;
  @IsOptional() @IsIn(QUESTION_TYPES) type?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}
class AddFromBankDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @Length(25, 25, { each: true }) questionIds?: string[];
  @ApiPropertyOptional({ description: 'Draw at random from this tag' }) @IsOptional() @IsString() @MaxLength(40) tag?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(200) count?: number;
}
class SaveToBankDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
}

@ApiTags('Creator · Question bank')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator', version: '1' })
export class QuestionBankController {
  constructor(private readonly bank: QuestionBankService) {}

  @Get('question-bank') @RequirePermissions(PERMISSIONS.COURSES_READ)
  list(@Query() q: BankListQuery) { return this.bank.list(q); }

  @Get('question-bank/tags') @RequirePermissions(PERMISSIONS.COURSES_READ)
  tags() { return this.bank.tags(); }

  @Post('question-bank') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  create(@Body() dto: BankQuestionDto, @CurrentAuth() auth: AuthContext) { return this.bank.create(dto, auth.userId); }

  @Put('question-bank/:id') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  @ApiOperation({ summary: 'Edit a bank question (quizzes that copied it keep their own version)' })
  update(@Param('id') id: string, @Body() dto: BankQuestionDto) { return this.bank.update(id, dto); }

  @Delete('question-bank/:id') @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.bank.remove(id, auth.userId); }

  @Post('courses/:id/lessons/:lessonId/quiz/questions/from-bank') @HttpCode(200) @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  @ApiOperation({ summary: 'Copy bank questions into the quiz (chosen ids, or N at random from a tag)' })
  addToQuiz(@Param('id') id: string, @Param('lessonId') l: string, @Body() dto: AddFromBankDto) { return this.bank.addToQuiz(id, l, dto); }

  @Post('courses/:id/lessons/:lessonId/quiz/questions/:qid/save-to-bank') @HttpCode(200) @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  saveToBank(@Param('id') id: string, @Param('lessonId') l: string, @Param('qid') qid: string, @Body() dto: SaveToBankDto, @CurrentAuth() auth: AuthContext) { return this.bank.saveFromQuiz(id, l, qid, dto.tags, auth.userId); }
}
