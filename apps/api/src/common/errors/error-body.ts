import { HttpException } from '@nestjs/common';
import { isUniqueViolation } from '@school/db/errors';
import { apiErrorSchema, statusForCode, type ApiError } from '@school/shared/errors/api-error';

export type Rendered = {
  readonly status: number;
  readonly body: ApiError;
  /** Set for failures nobody planned for; they are logged with their cause. */
  readonly unexpected: boolean;
};

const render = (code: ApiError['code'], message: string, unexpected = false): Rendered => ({
  status: statusForCode(code),
  body: { code, message },
  unexpected,
});

const fromStatus = (status: number): Rendered | undefined => {
  if (status === 404) return render('NOT_FOUND', 'Not found');
  if (status === 413) return render('PAYLOAD_TOO_LARGE', 'The request body is too large');
  if (status === 415) return render('UNSUPPORTED_MEDIA_TYPE', 'Unsupported content type');
  if (status >= 400 && status < 500) return render('MALFORMED_REQUEST', 'Malformed request');
  return undefined;
};

/** Turns anything thrown into the one error format. Internal details never leave the server. */
export const renderError = (error: unknown): Rendered => {
  if (error instanceof HttpException) {
    const planned = apiErrorSchema.safeParse(error.getResponse());
    if (planned.success) {
      return { status: error.getStatus(), body: planned.data, unexpected: false };
    }
    const known = fromStatus(error.getStatus());
    if (known) return known;
  }
  if (isUniqueViolation(error)) return render('CONFLICT', 'This record already exists');
  return render('INTERNAL', 'The request could not be completed', true);
};
