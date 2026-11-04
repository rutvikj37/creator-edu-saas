import { ValidationError, ValidationPipe } from '@nestjs/common';
import { AppException, type FieldError } from './errors/app-exception.js';

function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = Object.values(e.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

/**
 * Global validation: unknown properties are rejected (so clients can never smuggle
 * fields like tenantId or role), payloads are transformed into DTO instances.
 */
export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) => AppException.validation(flatten(errors)),
  });
}
