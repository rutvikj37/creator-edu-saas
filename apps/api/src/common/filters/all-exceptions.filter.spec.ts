import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { AppException } from '../errors/app-exception.js';

function run(exception: unknown) {
  const out: { status?: number; json?: any } = {};
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: unknown) {
      out.json = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ id: 'req-1', url: '/x' }) }),
  } as any;
  new AllExceptionsFilter().catch(exception, host);
  return out;
}

describe('AllExceptionsFilter', () => {
  it('maps AppException with code and details', () => {
    const out = run(AppException.validation([{ field: 'email', message: 'Invalid email' }]));
    expect(out.status).toBe(422);
    expect(out.json).toEqual({
      success: false,
      error: { code: 'VALIDATION_FAILED', message: 'Some fields are invalid', details: [{ field: 'email', message: 'Invalid email' }], requestId: 'req-1' },
    });
  });

  it('maps framework HTTP exceptions to stable codes', () => {
    expect(run(new NotFoundException()).json.error.code).toBe('NOT_FOUND');
    expect(run(new BadRequestException('bad')).json.error.code).toBe('BAD_REQUEST');
  });

  it('hides internal error details', () => {
    const out = run(new Error('ER_ACCESS_DENIED: password for root'));
    expect(out.status).toBe(500);
    expect(JSON.stringify(out.json)).not.toContain('root');
    expect(out.json.error.code).toBe('INTERNAL');
  });
});
