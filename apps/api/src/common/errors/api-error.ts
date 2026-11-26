import { HttpException } from '@nestjs/common';
import {
  statusForCode,
  type ApiError,
  type ErrorCode,
  type FieldError,
} from '@school/shared/errors/api-error';

/** An expected failure, rendered as the shared error body. */
export const apiError = (
  code: ErrorCode,
  message: string,
  fields?: readonly FieldError[],
): HttpException => {
  const body: ApiError = { code, message, ...(fields ? { fields: [...fields] } : {}) };
  return new HttpException(body, statusForCode(code));
};
