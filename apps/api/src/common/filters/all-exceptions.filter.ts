import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ERROR_CODES } from '@ce/shared';
import { AppException, type FieldError } from '../errors/app-exception.js';
import { Prisma } from '../../generated/prisma/client.js';

const STATUS_TO_CODE: Record<number, string> = {
  400: ERROR_CODES.BAD_REQUEST,
  401: ERROR_CODES.UNAUTHENTICATED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  422: ERROR_CODES.VALIDATION_FAILED,
  429: ERROR_CODES.RATE_LIMITED,
};

interface ErrorBody {
  code: string;
  message: string;
  details?: FieldError[];
  requestId?: string;
}

/**
 * Single place that shapes every error response. Internal details (stack traces, SQL,
 * Prisma meta) are logged server-side and never sent to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const { status, body } = this.toResponse(exception);
    body.requestId = req.id ? String(req.id) : undefined;

    if (status >= 500) {
      this.logger.error({ err: exception, requestId: body.requestId, path: req.url }, 'Unhandled error');
    }
    res.status(status).json({ success: false, error: body });
  }

  private toResponse(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        body: { code: exception.code, message: exception.message, details: exception.details },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : Array.isArray((response as { message?: unknown }).message)
            ? 'Some fields are invalid'
            : String((response as { message?: unknown }).message ?? exception.message);
      return {
        status,
        body: { code: STATUS_TO_CODE[status] ?? (status >= 500 ? ERROR_CODES.INTERNAL : ERROR_CODES.BAD_REQUEST), message },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return { status: HttpStatus.CONFLICT, body: { code: ERROR_CODES.CONFLICT, message: 'A record with these details already exists' } };
      }
      if (exception.code === 'P2025') {
        return { status: HttpStatus.NOT_FOUND, body: { code: ERROR_CODES.NOT_FOUND, message: 'Resource not found' } };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: ERROR_CODES.INTERNAL, message: 'Something went wrong. Please try again.' },
    };
  }
}
