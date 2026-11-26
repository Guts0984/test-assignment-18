import { z } from 'zod';
import { currencySchema } from '../money/money';
import { localDateSchema } from '../schedule/zoned';
import { ENROLLMENT_STATUSES } from '../status/enrollment';
import { idSchema, instantSchema, pageOf, pageShape, text } from './common';
import { MAX_CAPACITY } from './manage';

export const promoCodeInputSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,32}$/, 'Letters, digits and hyphens, 3 to 32 characters');

export const holdSeatSchema = z.strictObject({
  cohortId: idSchema,
  promoCode: promoCodeInputSchema.optional(),
});
export const applyPromoSchema = z.strictObject({ code: promoCodeInputSchema });
export const transferSchema = z.strictObject({ targetCohortId: idSchema });
export const excludeSchema = z.strictObject({ refundPolicy: z.enum(['rule', 'full']) });
export const changeCapacitySchema = z.strictObject({
  capacity: z.number().int().min(0).max(MAX_CAPACITY),
});

export const enrollmentSchema = z.object({
  id: idSchema,
  cohortId: idSchema,
  courseId: idSchema,
  courseTitle: z.string(),
  startDate: localDateSchema,
  startsAt: instantSchema,
  timeZone: z.string(),
  status: z.enum(ENROLLMENT_STATUSES),
  listPriceMinor: z.number().int(),
  priceMinor: z.number().int(),
  currency: currencySchema,
  paidMinor: z.number().int(),
  holdExpiresAt: instantSchema.nullable(),
  /** The server's clock, which the countdown is computed against. */
  serverNow: instantSchema,
  promoCode: z.string().nullable(),
  /** Set while a transfer waits for its surcharge. */
  transferFromId: idSchema.nullable(),
});

export const enrollmentListSchema = z.object({ items: z.array(enrollmentSchema) });

export const refundPreviewSchema = z.object({
  percent: z.union([z.literal(100), z.literal(50), z.literal(0)]),
  amountMinor: z.number().int(),
  currency: currencySchema,
  paidMinor: z.number().int(),
});

export const transferOptionSchema = z.object({
  cohortId: idSchema,
  startDate: localDateSchema,
  startsAt: instantSchema,
  timeZone: z.string(),
  freeSeats: z.number().int(),
  priceMinor: z.number().int(),
  currency: currencySchema,
  /** Positive: to pay. Negative: refunded. */
  differenceMinor: z.number().int(),
});
export const transferOptionsSchema = z.object({ items: z.array(transferOptionSchema) });

export const checkoutSchema = z.object({ payUrl: z.url() });

export const waitlistEntrySchema = z.object({
  cohortId: idSchema,
  courseTitle: z.string(),
  startDate: localDateSchema,
  status: z.enum(['waiting', 'offered']),
  /** Place in the queue, from 1. Null once a seat is offered. */
  place: z.number().int().min(1).nullable(),
  enrollmentId: idSchema.nullable(),
});
export const waitlistListSchema = z.object({ items: z.array(waitlistEntrySchema) });

export const studentQuerySchema = z.strictObject({ q: text(0, 100).optional(), ...pageShape });

export const cohortStudentSchema = z.object({
  enrollmentId: idSchema,
  studentId: idSchema,
  fullName: z.string(),
  email: z.string(),
  status: z.enum(ENROLLMENT_STATUSES),
  priceMinor: z.number().int(),
  paidMinor: z.number().int(),
  currency: currencySchema,
});
export const cohortStudentPageSchema = pageOf(cohortStudentSchema);

export const cohortWaitlistSchema = z.object({
  items: z.array(
    z.object({
      studentId: idSchema,
      fullName: z.string(),
      email: z.string(),
      status: z.enum(['waiting', 'offered', 'converted', 'offer_expired', 'left']),
      joinedAt: instantSchema,
      offeredAt: instantSchema.nullable(),
    }),
  ),
});

export const moneyRowSchema = z.object({
  id: idSchema,
  enrollmentId: idSchema,
  studentName: z.string(),
  kind: z.enum(['payment', 'refund', 'transfer_out', 'transfer_in', 'refund_pending']),
  amountMinor: z.number().int(),
  currency: currencySchema,
  at: instantSchema,
});
export const moneyPageSchema = pageOf(moneyRowSchema);

export const studentSearchSchema = z.strictObject({ q: text(2, 100), ...pageShape });
export const studentSearchPageSchema = pageOf(
  z.object({
    studentId: idSchema,
    fullName: z.string(),
    email: z.string(),
    enrollments: z.array(
      z.object({
        enrollmentId: idSchema,
        cohortId: idSchema,
        courseTitle: z.string(),
        startDate: localDateSchema,
        status: z.enum(ENROLLMENT_STATUSES),
      }),
    ),
  }),
);

export type EnrollmentView = z.infer<typeof enrollmentSchema>;
export type RefundPreview = z.infer<typeof refundPreviewSchema>;
export type WaitlistEntryView = z.infer<typeof waitlistEntrySchema>;
