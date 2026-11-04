import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './services/auth.service.js';
import { EmailVerificationService } from './services/email-verification.service.js';
import { GoogleOAuthService } from './services/google-oauth.service.js';
import { OtpService } from './services/otp.service.js';
import { PasswordResetService } from './services/password-reset.service.js';
import { PasswordService } from './services/password.service.js';
import { SessionService } from './services/session.service.js';
import { TokenService } from './services/token.service.js';
import { TwoFactorService } from './services/two-factor.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { TenantGuard } from './guards/tenant.guard.js';
import { PermissionsGuard } from './guards/permissions.guard.js';

@Module({
  imports: [TenantsModule],
  controllers: [AuthController],
  providers: [
    AuthService, EmailVerificationService, GoogleOAuthService, OtpService, PasswordResetService, PasswordService,
    SessionService, TokenService, TwoFactorService, JwtAuthGuard, TenantGuard, PermissionsGuard,
  ],
  exports: [SessionService, TokenService, PasswordService, AuthService, JwtAuthGuard, TenantGuard, PermissionsGuard],
})
export class AuthModule {}
