import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { AllowMfaSetup, ClientMetaParam, CurrentAuth } from '../../common/decorators/auth.decorators.js';
import { AppException } from '../../common/errors/app-exception.js';
import { AppConfig } from '../../config/app-config.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { SmsService } from '../../core/sms/sms.service.js';
import { MailService } from '../../core/mail/mail.service.js';
import { emailTemplates } from '../../core/mail/templates.js';
import { realmKeyOf, type AppRequest, type AuthContext, type HostRealm } from '../../core/tenancy/request-context.js';
import { AuditService } from '../../core/audit/audit.service.js';
import { AuthzService } from '../authz/authz.service.js';
import {
  ChangePasswordDto, CodeDto, DisableMfaDto, ForgotPasswordDto, HandoffDto, LoginDto, MfaLoginDto, RegisterCreatorDto,
  RegisterStudentDto, ResetPasswordDto, SendOtpDto, SwitchTenantDto, TokenDto,
} from './dto/auth.dto.js';
import { assertCsrf, clearSessionCookies, readRefreshToken, setSessionCookies } from './auth.cookies.js';
import { AuthService } from './services/auth.service.js';
import { EmailVerificationService } from './services/email-verification.service.js';
import { GoogleOAuthService } from './services/google-oauth.service.js';
import { OtpService } from './services/otp.service.js';
import { PasswordResetService } from './services/password-reset.service.js';
import { PasswordService } from './services/password.service.js';
import { SessionService, type ClientMeta, type IssuedSession } from './services/session.service.js';
import { TwoFactorService } from './services/two-factor.service.js';
import { PUBLIC_USER_SELECT } from './services/user-view.js';

const authLimit = { default: { limit: () => Number(process.env.AUTH_RATE_LIMIT_PER_MINUTE ?? 10), ttl: 60_000 } };

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly emailVerification: EmailVerificationService,
    private readonly resets: PasswordResetService,
    private readonly otp: OtpService,
    private readonly twoFactor: TwoFactorService,
    private readonly google: GoogleOAuthService,
    private readonly passwords: PasswordService,
    private readonly authz: AuthzService,
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {
    this.secureCookies = config.isProduction;
  }

  // ── helpers ────────────────────────────────────────────────────────
  private host(req: AppRequest): HostRealm {
    if (!req.hostRealm) throw AppException.notFound();
    return req.hostRealm;
  }

  private origin(req: AppRequest) {
    return `${req.protocol}://${req.get('host')}`;
  }

  private async brand(host: HostRealm): Promise<string> {
    if (host.kind === 'tenant') {
      const t = await this.prisma.tenant.findUnique({ where: { id: host.tenantId }, select: { name: true } });
      if (t) return t.name;
    }
    return this.config.get('APP_NAME');
  }

  private respond(res: Response, s: Pick<IssuedSession, 'accessToken' | 'refreshToken' | 'expiresIn' | 'refreshExpiresAt'>, extra: object = {}) {
    setSessionCookies(res, s.refreshToken, s.refreshExpiresAt, this.secureCookies);
    return { accessToken: s.accessToken, expiresIn: s.expiresIn, ...extra };
  }

  // ── registration & login ───────────────────────────────────────────
  @Public()
  @Throttle(authLimit)
  @Post('register/creator')
  @ApiOperation({ summary: 'Creator sign-up (platform host): creates account and academy workspace' })
  async registerCreator(@Body() dto: RegisterCreatorDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response, @ClientMetaParam() meta: ClientMeta) {
    if (this.host(req).kind !== 'platform') throw AppException.notFound();
    const { user, tenant, session } = await this.auth.registerCreator(dto, meta);
    await this.emailVerification.send(user, this.origin(req), this.config.get('APP_NAME'));
    return this.respond(res, session, { tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name } });
  }

  @Public()
  @Throttle(authLimit)
  @Post('register/student')
  @ApiOperation({ summary: 'Student sign-up on an academy host' })
  async registerStudent(@Body() dto: RegisterStudentDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response, @ClientMetaParam() meta: ClientMeta) {
    const host = this.host(req);
    const { user, session } = await this.auth.registerStudent(dto, host, meta);
    await this.emailVerification.send(user, this.origin(req), await this.brand(host));
    return this.respond(res, session);
  }

  @Public()
  @Throttle(authLimit)
  @HttpCode(200)
  @Post('login')
  @ApiOperation({ summary: 'Password sign-in for the realm of the current host' })
  async login(@Body() dto: LoginDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response, @ClientMetaParam() meta: ClientMeta) {
    const result = await this.auth.login(dto, this.host(req), meta);
    if (result.kind === 'mfa') return { mfaRequired: true, mfaToken: result.mfaToken };
    return this.respond(res, result.session, { mfaSetupRequired: result.session.auth.mfaSetupRequired });
  }

  @Public()
  @Throttle(authLimit)
  @HttpCode(200)
  @Post('login/2fa')
  @ApiOperation({ summary: 'Second step of sign-in with an authenticator code' })
  async loginMfa(@Body() dto: MfaLoginDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response, @ClientMetaParam() meta: ClientMeta) {
    const session = await this.auth.completeMfaLogin(dto.mfaToken, dto.code, this.host(req), meta);
    return this.respond(res, session, { mfaSetupRequired: false });
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate the refresh cookie and get a new access token (requires X-CSRF-Token)' })
  async refresh(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response, @ClientMetaParam() meta: ClientMeta) {
    const token = readRefreshToken(req, this.secureCookies);
    if (!token) throw AppException.unauthenticated('Not signed in');
    assertCsrf(req, this.secureCookies);
    try {
      const out = await this.auth.refresh(token, this.host(req), meta);
      return this.respond(res, out, { mfaSetupRequired: out.auth.mfaSetupRequired });
    } catch (err) {
      clearSessionCookies(res, this.secureCookies);
      throw err;
    }
  }

  @AllowMfaSetup()
  @HttpCode(200)
  @Post('logout')
  async logout(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revokeFamily(auth.sessionId, 'logout');
    clearSessionCookies(res, this.secureCookies);
    return { signedOut: true };
  }

  @HttpCode(200)
  @Post('logout-all')
  async logoutAll(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    const count = await this.sessions.revokeAllForUser(auth.userId, 'logout_all');
    clearSessionCookies(res, this.secureCookies);
    return { signedOut: count };
  }

  @AllowMfaSetup()
  @Get('me')
  @ApiOperation({ summary: 'Current user, roles, permissions and workspaces' })
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.me(auth);
  }

  @HttpCode(200)
  @Post('switch-tenant')
  @ApiOperation({ summary: 'Switch the active creator workspace (membership verified server-side)' })
  switchTenant(@CurrentAuth() auth: AuthContext, @Body() dto: SwitchTenantDto) {
    return this.auth.switchTenant(auth, dto.tenantId);
  }

  // ── sessions ───────────────────────────────────────────────────────
  @Get('sessions')
  async listSessions(@CurrentAuth() auth: AuthContext) {
    const rows = await this.sessions.listActive(auth.userId);
    return rows.map((r) => ({ id: r.familyId, userAgent: r.userAgent, ip: r.ip, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, current: r.familyId === auth.sessionId }));
  }

  @Delete('sessions/:id')
  async revokeSession(@CurrentAuth() auth: AuthContext, @Param('id') id: string) {
    const owned = await this.prisma.userSession.findFirst({ where: { familyId: id, userId: auth.userId }, select: { id: true } });
    if (!owned) throw AppException.notFound('Session not found');
    await this.sessions.revokeFamily(id, 'revoked_by_user');
    return { revoked: true };
  }

  // ── email verification & OTP ───────────────────────────────────────
  @Public()
  @Throttle(authLimit)
  @HttpCode(200)
  @Post('email/verify')
  @ApiOperation({ summary: 'Verify email with the token from the link' })
  async verifyEmail(@Body() dto: TokenDto, @Req() req: AppRequest) {
    await this.emailVerification.verifyToken(dto.token, realmKeyOf(this.host(req)));
    return { verified: true };
  }

  @Throttle(authLimit)
  @HttpCode(200)
  @Post('email/verify-code')
  @ApiOperation({ summary: 'Verify email with the 6-digit code (signed in)' })
  async verifyEmailCode(@CurrentAuth() auth: AuthContext, @Body() dto: CodeDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    await this.emailVerification.verifyCode(user, dto.code);
    return { verified: true };
  }

  @Throttle(authLimit)
  @HttpCode(200)
  @Post('email/resend')
  async resendVerification(@CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (user.emailVerifiedAt) return { alreadyVerified: true };
    await this.emailVerification.send(user, this.origin(req), await this.brand(this.host(req)));
    return { sent: true };
  }

  @Throttle(authLimit)
  @HttpCode(200)
  @Post('otp/send')
  @ApiOperation({ summary: 'Send a one-time code to the signed-in user (email or SMS)' })
  async sendOtp(@CurrentAuth() auth: AuthContext, @Body() dto: SendOtpDto, @Req() req: AppRequest) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    const brand = await this.brand(this.host(req));
    if (dto.purpose === 'EMAIL_VERIFY') {
      const code = await this.otp.issue({ userId: user.id, channel: 'email', target: user.email, purpose: 'EMAIL_VERIFY' });
      await this.mail.send({ to: user.email, tenantId: user.tenantId, tag: 'otp', ...emailTemplates.otp({ brand, code, purpose: 'verify your email' }) });
      return { sent: true, channel: 'email' };
    }
    if (!user.phone) throw AppException.validation([{ field: 'phone', message: 'Add a mobile number first' }]);
    if (!this.sms.isConfigured()) throw AppException.integrationNotConfigured('SMS delivery');
    const code = await this.otp.issue({ userId: user.id, channel: 'sms', target: user.phone, purpose: 'PHONE_VERIFY' });
    await this.sms.send(user.phone, `${code} is your ${brand} verification code. It expires in 10 minutes.`, { otp: code });
    return { sent: true, channel: 'sms' };
  }

  @Throttle(authLimit)
  @HttpCode(200)
  @Post('otp/verify')
  async verifyOtp(@CurrentAuth() auth: AuthContext, @Body() dto: SendOtpDto & CodeDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    const target = dto.purpose === 'PHONE_VERIFY' ? user.phone : user.email;
    if (!target) throw AppException.validation([{ field: 'phone', message: 'Add a mobile number first' }]);
    await this.otp.verify({ userId: user.id, target, purpose: dto.purpose, code: dto.code });
    await this.prisma.user.update({ where: { id: user.id }, data: dto.purpose === 'PHONE_VERIFY' ? { phoneVerifiedAt: new Date() } : { emailVerifiedAt: new Date() } });
    return { verified: true };
  }

  // ── passwords ──────────────────────────────────────────────────────
  @Public()
  @Throttle(authLimit)
  @HttpCode(200)
  @Post('password/forgot')
  @ApiOperation({ summary: 'Request a reset link (always succeeds to prevent account enumeration)' })
  async forgot(@Body() dto: ForgotPasswordDto, @Req() req: AppRequest) {
    const host = this.host(req);
    await this.resets.request(dto.email, realmKeyOf(host), this.origin(req), await this.brand(host));
    return { sent: true };
  }

  @Public()
  @Throttle(authLimit)
  @HttpCode(200)
  @Post('password/reset')
  async reset(@Body() dto: ResetPasswordDto, @Req() req: AppRequest, @ClientMetaParam() meta: ClientMeta) {
    const host = this.host(req);
    await this.resets.reset(dto.token, dto.password, realmKeyOf(host), await this.brand(host), meta);
    return { reset: true };
  }

  @Throttle(authLimit)
  @HttpCode(200)
  @Post('password/change')
  async changePassword(@CurrentAuth() auth: AuthContext, @Body() dto: ChangePasswordDto, @Req() req: AppRequest, @ClientMetaParam() meta: ClientMeta) {
    return this.auth.changePassword(auth, dto, meta, await this.brand(this.host(req)));
  }

  // ── two-factor ─────────────────────────────────────────────────────
  @AllowMfaSetup()
  @HttpCode(200)
  @Post('2fa/setup')
  @ApiOperation({ summary: 'Start TOTP enrolment: returns secret and otpauth URL for a QR code' })
  async setup2fa(@CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (user.twoFactorEnabledAt) throw AppException.conflict('Two-factor authentication is already enabled.');
    return this.twoFactor.beginSetup(user, await this.brand(this.host(req)));
  }

  @AllowMfaSetup()
  @Throttle(authLimit)
  @HttpCode(200)
  @Post('2fa/enable')
  async enable2fa(@CurrentAuth() auth: AuthContext, @Body() dto: CodeDto, @Res({ passthrough: true }) res: Response, @ClientMetaParam() meta: ClientMeta) {
    await this.twoFactor.confirmSetup(auth.userId, dto.code);
    await this.audit.record({ action: 'auth.2fa_enabled', actorUserId: auth.userId, actorRealm: auth.realm, targetType: 'User', targetId: auth.userId, ip: meta.ip, userAgent: meta.userAgent });
    // Replace the (possibly restricted) session with a fully privileged one.
    await this.sessions.revokeFamily(auth.sessionId, '2fa_enabled');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    const session = await this.auth.startSession(user, auth.realmKey, meta, 'totp_enrol');
    return this.respond(res, session, { enabled: true });
  }

  @Throttle(authLimit)
  @HttpCode(200)
  @Post('2fa/disable')
  async disable2fa(@CurrentAuth() auth: AuthContext, @Body() dto: DisableMfaDto, @ClientMetaParam() meta: ClientMeta) {
    if (await this.authz.requiresMfa(auth.userId)) throw AppException.forbidden('Administrators must keep two-factor authentication enabled.');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!(await this.passwords.verify(user.passwordHash, dto.password))) throw AppException.validation([{ field: 'password', message: 'Password is incorrect' }]);
    if (!(await this.twoFactor.verify(user, dto.code))) throw AppException.validation([{ field: 'code', message: 'The code is incorrect' }]);
    await this.twoFactor.disable(user.id);
    await this.audit.record({ action: 'auth.2fa_disabled', actorUserId: user.id, actorRealm: user.realm, tenantId: user.tenantId, targetType: 'User', targetId: user.id, ip: meta.ip, userAgent: meta.userAgent });
    return { disabled: true };
  }

  // ── Google ─────────────────────────────────────────────────────────
  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'Which sign-in providers are configured' })
  providers() {
    return { google: this.google.isConfigured(), sms: this.sms.isConfigured() };
  }

  @Public()
  @Get('google/start')
  async googleStart(@Req() req: AppRequest, @Res() res: Response) {
    res.redirect(302, await this.google.authorizationUrl(realmKeyOf(this.host(req)), this.origin(req)));
  }

  @Public()
  @Get('google/callback')
  async googleCallback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string | undefined, @Res() res: Response) {
    if (error || !code || !state) return res.redirect(302, `${this.config.get('WEB_PUBLIC_URL')}/login?error=google_cancelled`);
    res.redirect(302, await this.google.handleCallback(code, state));
  }

  @Public()
  @Throttle(authLimit)
  @HttpCode(200)
  @Post('google/handoff')
  async googleHandoff(@Body() dto: HandoffDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response, @ClientMetaParam() meta: ClientMeta) {
    const host = this.host(req);
    const userId = await this.google.consumeHandoff(dto.code, realmKeyOf(host));
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== 'ACTIVE') throw AppException.forbidden('This account is not active.');
    // Google proves the first factor only; accounts with 2FA still need their authenticator code.
    if (user.twoFactorEnabledAt) return { mfaRequired: true, mfaToken: await this.auth.mfaChallenge(user.id, realmKeyOf(host)) };
    const session = await this.auth.startSession(user, realmKeyOf(host), meta, 'google');
    return this.respond(res, session, { mfaSetupRequired: session.auth.mfaSetupRequired, user: await this.prisma.user.findUnique({ where: { id: user.id }, select: PUBLIC_USER_SELECT }) });
  }
}
