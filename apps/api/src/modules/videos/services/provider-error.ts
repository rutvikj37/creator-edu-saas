import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@ce/shared';
import { AppException } from '../../../common/errors/app-exception.js';
import { BunnyApiError } from '../providers/bunny/bunny.client.js';

/** Maps provider failures to API errors without leaking provider responses or credentials. */
export function providerError(e: unknown, fallback: string) {
  if (e instanceof AppException) return e;
  if (e instanceof BunnyApiError) {
    if (e.status === 0 && !e.retryable) return new AppException(ERROR_CODES.INTEGRATION_NOT_CONFIGURED, 'Video hosting is not configured on this platform yet.', HttpStatus.SERVICE_UNAVAILABLE);
    if (e.status === 401 || e.status === 403) return new AppException(ERROR_CODES.INTEGRATION_NOT_CONFIGURED, 'The video provider rejected the platform credentials.', HttpStatus.SERVICE_UNAVAILABLE);
    if (e.retryable) return new AppException(ERROR_CODES.RATE_LIMITED, 'The video provider is busy or unreachable. Please try again shortly.', HttpStatus.SERVICE_UNAVAILABLE);
    if (e.status === 404) return AppException.notFound('The video no longer exists at the provider');
  }
  return new AppException(ERROR_CODES.INTERNAL, fallback, HttpStatus.BAD_GATEWAY);
}
