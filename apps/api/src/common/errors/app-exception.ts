import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@ce/shared';

export interface FieldError {
  field: string;
  message: string;
}

/**
 * Domain exception carrying a stable error code. Services throw this; the global
 * exception filter turns it into the standard error envelope.
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
    public readonly details?: FieldError[],
  ) {
    super({ code, message, details }, status);
  }

  static notFound(message = 'Resource not found') {
    return new AppException(ERROR_CODES.NOT_FOUND, message, HttpStatus.NOT_FOUND);
  }
  static forbidden(message = 'You do not have permission to perform this action') {
    return new AppException(ERROR_CODES.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }
  static unauthenticated(message = 'Authentication required') {
    return new AppException(ERROR_CODES.UNAUTHENTICATED, message, HttpStatus.UNAUTHORIZED);
  }
  static conflict(message: string) {
    return new AppException(ERROR_CODES.CONFLICT, message, HttpStatus.CONFLICT);
  }
  static validation(details: FieldError[], message = 'Some fields are invalid') {
    return new AppException(ERROR_CODES.VALIDATION_FAILED, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
  static integrationNotConfigured(integration: string) {
    return new AppException(
      ERROR_CODES.INTEGRATION_NOT_CONFIGURED,
      `${integration} is not configured. Add its credentials in Integrations.`,
      HttpStatus.CONFLICT,
    );
  }
}
