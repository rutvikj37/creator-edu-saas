import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, TenantScoped } from '../../common/decorators/auth.decorators.js';
import type { AppRequest, AuthContext } from '../../core/tenancy/request-context.js';
import { apiOrigin } from '../files/files.controller.js';
import { CoursesService } from './courses.service.js';
import {
  CourseListQuery, CreateCourseDto, CreateLessonDto, CurriculumOrderDto, InstructorsDto, PublishCourseDto, SectionDto, UpdateCourseDto, UpdateLessonDto,
} from './dto/course.dto.js';

@ApiTags('Creator · Courses')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator/courses', version: '1' })
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.COURSES_READ)
  list(@Query() q: CourseListQuery, @Req() req: AppRequest) {
    return this.courses.list(q, apiOrigin(req));
  }

  @Post()
  @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  @ApiOperation({ summary: 'Create a draft course (counts toward the plan course limit)' })
  create(@Body() dto: CreateCourseDto, @CurrentAuth() auth: AuthContext) {
    return this.courses.create(dto, auth);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.COURSES_READ)
  get(@Param('id') id: string, @Req() req: AppRequest) {
    return this.courses.detail(id, apiOrigin(req));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateCourseDto, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.courses.update(id, dto, auth, apiOrigin(req));
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.courses.remove(id, auth);
  }

  @Get(':id/publish-check')
  @RequirePermissions(PERMISSIONS.COURSES_READ)
  async publishCheck(@Param('id') id: string) {
    const problems = await this.courses.publishProblems(id);
    return { ready: problems.length === 0, problems };
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  publish(@Param('id') id: string, @Body() dto: PublishCourseDto, @CurrentAuth() auth: AuthContext) {
    return this.courses.publish(id, dto.publishAt, auth);
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  unpublish(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.courses.setStatus(id, 'UNPUBLISHED', auth);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  archive(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.courses.setStatus(id, 'ARCHIVED', auth);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  restore(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.courses.setStatus(id, 'DRAFT', auth);
  }

  @Post(':id/duplicate')
  @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  duplicate(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.courses.duplicate(id, auth);
  }

  @Put(':id/instructors')
  @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  instructors(@Param('id') id: string, @Body() dto: InstructorsDto) {
    return this.courses.setInstructors(id, dto.userIds);
  }

  @Get(':id/curriculum')
  @RequirePermissions(PERMISSIONS.COURSES_READ)
  curriculum(@Param('id') id: string) {
    return this.courses.curriculum(id);
  }

  @Put(':id/curriculum/order')
  @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  @ApiOperation({ summary: 'Persist drag-and-drop ordering of sections, lessons and sub-lessons' })
  reorder(@Param('id') id: string, @Body() dto: CurriculumOrderDto) {
    return this.courses.reorder(id, dto);
  }

  @Post(':id/sections')
  @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  addSection(@Param('id') id: string, @Body() dto: SectionDto) {
    return this.courses.addSection(id, dto);
  }

  @Patch(':id/sections/:sectionId')
  @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  updateSection(@Param('id') id: string, @Param('sectionId') sectionId: string, @Body() dto: SectionDto) {
    return this.courses.updateSection(id, sectionId, dto);
  }

  @Delete(':id/sections/:sectionId')
  @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  removeSection(@Param('id') id: string, @Param('sectionId') sectionId: string) {
    return this.courses.removeSection(id, sectionId);
  }

  @Post(':id/lessons')
  @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  addLesson(@Param('id') id: string, @Body() dto: CreateLessonDto) {
    return this.courses.addLesson(id, dto);
  }

  @Patch(':id/lessons/:lessonId')
  @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  updateLesson(@Param('id') id: string, @Param('lessonId') lessonId: string, @Body() dto: UpdateLessonDto) {
    return this.courses.updateLesson(id, lessonId, dto);
  }

  @Delete(':id/lessons/:lessonId')
  @RequirePermissions(PERMISSIONS.COURSES_MANAGE)
  removeLesson(@Param('id') id: string, @Param('lessonId') lessonId: string) {
    return this.courses.removeLesson(id, lessonId);
  }
}
