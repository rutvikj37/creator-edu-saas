import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { PERMISSIONS } from '@ce/shared';
import { ClientMetaParam, CurrentAuth, RequirePermissions, RequireRealm, TenantScoped } from '../../common/decorators/auth.decorators.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type { AppRequest, AuthContext } from '../../core/tenancy/request-context.js';
import { PasswordService } from '../auth/services/password.service.js';
import { AuthService } from '../auth/services/auth.service.js';
import { setSessionCookies } from '../auth/auth.cookies.js';
import type { ClientMeta } from '../auth/services/session.service.js';
import { StaffService } from './staff.service.js';
import { RolesService } from './roles.service.js';

class InviteDto {
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail({}, { message: 'Enter a valid email address' }) email: string;
  @ApiProperty() @IsString() roleKey: string;
}
class RoleDto {
  @ApiProperty() @IsString() roleKey: string;
}
class CreateRoleDto {
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @Length(1, 60) name: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) permissions: string[];
}
class UpdateRoleDto {
  @ApiProperty({ required: false }) @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @Length(1, 60) name?: string;
  @ApiProperty({ required: false, type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) permissions?: string[];
}
class TokenBody {
  @ApiProperty() @IsString() @Length(20, 200) token: string;
}
class RegisterStaffDto extends TokenBody {
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @Length(2, 120) fullName: string;
  @ApiProperty() @IsString() @MinLength(10, { message: 'Password must be at least 10 characters' }) @MaxLength(128) password: string;
}

@ApiTags('Creator · Staff')
@ApiBearerAuth()
@TenantScoped('workspace')
@RequirePermissions(PERMISSIONS.STAFF_MANAGE)
@Controller({ path: 'creator/staff', version: '1' })
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  list() {
    return this.staff.list();
  }

  @Post('invitations')
  invite(@Body() dto: InviteDto, @CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.staff.invite(dto.email, dto.roleKey, auth.userId, `${req.protocol}://${req.get('host')}`);
  }

  @Delete('invitations/:id')
  revoke(@Param('id') id: string, @CurrentAuth() auth: AuthContext) {
    return this.staff.revokeInvitation(id, auth.userId);
  }

  @Patch(':memberId')
  changeRole(@Param('memberId') id: string, @Body() dto: RoleDto, @CurrentAuth() auth: AuthContext) {
    return this.staff.changeRole(id, dto.roleKey, auth.userId);
  }

  @Delete(':memberId')
  remove(@Param('memberId') id: string, @CurrentAuth() auth: AuthContext) {
    return this.staff.remove(id, auth.userId);
  }
}

@ApiTags('Staff invitations')
@Controller({ path: 'invitations', version: '1' })
export class InvitationsController {
  constructor(
    private readonly staff: StaffService,
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Get(':token')
  async lookup(@Param('token') token: string, @Req() req: AppRequest) {
    if (req.hostRealm?.kind !== 'platform') throw AppException.notFound();
    return (await this.staff.lookup(token)).view;
  }

  @RequireRealm('PLATFORM')
  @HttpCode(200)
  @Post('accept')
  async accept(@Body() dto: TokenBody, @CurrentAuth() auth: AuthContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    return this.staff.accept(dto.token, user);
  }

  /** New staff member without an account: create a platform account (no academy) and join. */
  @Public()
  @Post('register')
  async register(@Body() dto: RegisterStaffDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response, @ClientMetaParam() meta: ClientMeta) {
    if (req.hostRealm?.kind !== 'platform') throw AppException.notFound();
    const { inv, view } = await this.staff.lookup(dto.token);
    if (view.hasAccount) throw AppException.conflict('An account with this email exists. Sign in to accept the invitation.');
    const user = await this.prisma.user.create({
      // The invitation link proves control of the email address.
      data: { realm: 'PLATFORM', realmKey: 'platform', email: inv.email, fullName: dto.fullName, passwordHash: await this.passwords.hash(dto.password), emailVerifiedAt: new Date(), passwordChangedAt: new Date() },
    });
    await this.staff.accept(dto.token, user);
    const session = await this.auth.startSession(user, 'platform', meta, 'invite');
    setSessionCookies(res, session.refreshToken, session.refreshExpiresAt, this.config.isProduction);
    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }
}

@ApiTags('Creator · Staff')
@ApiBearerAuth()
@TenantScoped('workspace')
@RequirePermissions(PERMISSIONS.STAFF_MANAGE)
@Controller({ path: 'creator/roles', version: '1' })
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list() { return this.roles.list(); }

  @Get('permissions')
  catalog() { return this.roles.catalog(); }

  @Post()
  create(@Body() dto: CreateRoleDto, @CurrentAuth() auth: AuthContext) { return this.roles.create(dto, auth.userId); }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto, @CurrentAuth() auth: AuthContext) { return this.roles.update(id, dto, auth.userId); }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentAuth() auth: AuthContext) { return this.roles.remove(id, auth.userId); }
}
