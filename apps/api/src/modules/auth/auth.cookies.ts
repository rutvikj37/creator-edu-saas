import type { Request, Response } from 'express';
import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@ce/shared';
import { randomToken, safeEqual } from '../../core/crypto/crypto.service.js';
import { AppException } from '../../common/errors/app-exception.js';

/**
 * Refresh token: httpOnly cookie (JS can't read it). In production the __Host- prefix
 * forces Secure + Path=/ + no Domain, so it is bound to exactly one host (each academy
 * domain gets its own session). CSRF: double-submit token required on cookie-authenticated calls.
 */
export function cookieNames(secure: boolean) {
  return { refresh: secure ? '__Host-rt' : 'rt', csrf: secure ? '__Host-csrf' : 'csrf' };
}

export function setSessionCookies(res: Response, refreshToken: string, expiresAt: Date, secure: boolean) {
  const names = cookieNames(secure);
  const csrf = randomToken(24);
  const base = { secure, sameSite: 'lax' as const, path: '/', expires: expiresAt };
  res.cookie(names.refresh, refreshToken, { ...base, httpOnly: true });
  res.cookie(names.csrf, csrf, { ...base, httpOnly: false });
  return csrf;
}

export function clearSessionCookies(res: Response, secure: boolean) {
  const names = cookieNames(secure);
  res.clearCookie(names.refresh, { path: '/', secure, sameSite: 'lax' });
  res.clearCookie(names.csrf, { path: '/', secure, sameSite: 'lax' });
}

export function readRefreshToken(req: Request, secure: boolean): string | undefined {
  return req.cookies?.[cookieNames(secure).refresh];
}

export function assertCsrf(req: Request, secure: boolean) {
  const cookie = req.cookies?.[cookieNames(secure).csrf];
  const header = req.get('x-csrf-token');
  if (!cookie || !header || !safeEqual(cookie, header)) {
    throw new AppException(ERROR_CODES.FORBIDDEN, 'Security check failed. Refresh the page and try again.', HttpStatus.FORBIDDEN);
  }
}
