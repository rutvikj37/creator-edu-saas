import { Body, Controller, Get, HttpCode, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@ce/shared';
import { CurrentAuth, RequirePermissions, TenantScoped } from '../../common/decorators/auth.decorators.js';
import type { AppRequest, AuthContext } from '../../core/tenancy/request-context.js';
import { apiOrigin } from '../files/files.controller.js';
import { AcademyService } from './academy.service.js';
import { OnboardingStepDto, UpdateAcademyDto, UpdateBusinessDto } from './dto/academy.dto.js';

@ApiTags('Creator · Academy')
@ApiBearerAuth()
@TenantScoped('workspace')
@Controller({ path: 'creator', version: '1' })
export class AcademyController {
  constructor(private readonly academy: AcademyService) {}

  @Get('academy')
  get(@Req() req: AppRequest) {
    return this.academy.get(apiOrigin(req));
  }

  @Put('academy')
  @RequirePermissions(PERMISSIONS.ACADEMY_MANAGE)
  @ApiOperation({ summary: 'Update academy profile and branding' })
  update(@Body() dto: UpdateAcademyDto, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.academy.update(dto, auth.userId, apiOrigin(req));
  }

  @Get('academy/business')
  @RequirePermissions(PERMISSIONS.ACADEMY_MANAGE)
  business() {
    return this.academy.getBusiness();
  }

  @Put('academy/business')
  @RequirePermissions(PERMISSIONS.ACADEMY_MANAGE)
  updateBusiness(@Body() dto: UpdateBusinessDto, @CurrentAuth() auth: AuthContext) {
    return this.academy.updateBusiness(dto, auth.userId);
  }

  @Get('onboarding')
  @ApiOperation({ summary: 'Onboarding progress derived from academy data' })
  onboarding(@CurrentAuth() auth: AuthContext) {
    return this.academy.onboarding(auth.userId);
  }

  @Put('onboarding/step')
  @RequirePermissions(PERMISSIONS.ACADEMY_MANAGE)
  async step(@Body() dto: OnboardingStepDto, @CurrentAuth() auth: AuthContext) {
    await this.academy.saveStep(dto.step);
    return this.academy.onboarding(auth.userId);
  }

  @Post('onboarding/publish')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.ACADEMY_MANAGE)
  @ApiOperation({ summary: 'Publish the academy (makes it live and open for student registration)' })
  publish(@CurrentAuth() auth: AuthContext) {
    return this.academy.publish(auth.userId);
  }
}
