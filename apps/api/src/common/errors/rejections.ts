import { type ErrorCode } from '@school/shared/errors/api-error';
import { apiError } from './api-error';

const MESSAGES = {
  NOT_FOUND: 'Not found',
  NO_SEATS: 'There are no free seats. You can join the waiting list.',
  ENROLLMENT_CLOSED: 'Enrollment closed when the cohort started',
  ALREADY_ENROLLED: 'You are already enrolled in this cohort',
  SEATS_AVAILABLE: 'There are free seats, so book one directly',
  INVALID_TRANSITION: 'This is not possible in the current status',
  HOLD_EXPIRED: 'The reservation has expired',
  PROMO_NOT_FOUND: 'There is no such promo code',
  PROMO_NOT_STARTED: 'This promo code is not valid yet',
  PROMO_EXPIRED: 'This promo code has expired',
  PROMO_EXHAUSTED: 'This promo code has been used up',
  PROMO_NOT_APPLICABLE: 'This promo code does not apply here',
  PROMO_ALREADY_APPLIED: 'A promo code is already applied',
  PROMO_CURRENCY_MISMATCH: 'This promo code is in another currency',
  TRANSFER_NOT_ALLOWED: 'This enrollment cannot be moved there',
  TRANSFER_CURRENCY_MISMATCH: 'The other cohort uses another currency',
  CAPACITY_BELOW_TAKEN: 'More seats than that are already taken',
  GATEWAY_NOT_CONFIGURED: 'The school has not connected a payment system',
  GATEWAY_UNAVAILABLE: 'The payment system is not responding. Try again.',
} as const satisfies Partial<Record<ErrorCode, string>>;

export type Rejection = keyof typeof MESSAGES;

export const rejected = (code: Rejection) => apiError(code, MESSAGES[code]);

export const messageFor = (code: Rejection): string => MESSAGES[code];
