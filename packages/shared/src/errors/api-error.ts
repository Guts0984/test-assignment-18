import { z } from 'zod';

/** Stable error codes mapped to their HTTP status. Codes are part of the public contract. */
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  MALFORMED_REQUEST: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  TOKEN_REUSED: 401,
  INVALID_SIGNATURE: 401,
  FORBIDDEN: 403,
  CSRF_REJECTED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  EMAIL_TAKEN: 409,
  NO_SEATS: 409,
  CAPACITY_BELOW_TAKEN: 409,
  ALREADY_ENROLLED: 409,
  SEATS_AVAILABLE: 409,
  HOLD_EXPIRED: 409,
  INVALID_TRANSITION: 409,
  PROMO_NOT_FOUND: 409,
  PROMO_NOT_STARTED: 409,
  PROMO_EXPIRED: 409,
  PROMO_EXHAUSTED: 409,
  PROMO_NOT_APPLICABLE: 409,
  PROMO_ALREADY_APPLIED: 409,
  PROMO_CURRENCY_MISMATCH: 409,
  TRANSFER_NOT_ALLOWED: 409,
  TRANSFER_CURRENCY_MISMATCH: 409,
  ALREADY_REFUNDED: 409,
  REVIEW_LIMIT_REACHED: 409,
  NOTHING_TO_REVIEW: 409,
  SUBMISSION_LOCKED: 409,
  CERTIFICATE_NOT_AVAILABLE: 409,
  GATEWAY_NOT_CONFIGURED: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  GATEWAY_UNAVAILABLE: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const errorCodes = Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]];

export const fieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const apiErrorSchema = z.object({
  code: z.enum(errorCodes),
  message: z.string(),
  fields: z.array(fieldErrorSchema).optional(),
  requestId: z.string().optional(),
});

export type FieldError = z.infer<typeof fieldErrorSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;

export const statusForCode = (code: ErrorCode): number => ERROR_STATUS[code];
