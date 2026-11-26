import { z } from 'zod';
import { currencySchema } from '../money/money';
import { localDateSchema } from '../schedule/zoned';
import { idSchema } from './common';

/** The longest period a report covers, in days (a little over two years). */
export const MAX_REPORT_DAYS = 800;

export const reportQuerySchema = z
  .strictObject({
    from: localDateSchema,
    to: localDateSchema,
    courseId: idSchema.optional(),
    cohortId: idSchema.optional(),
    currency: currencySchema.optional(),
  })
  .refine((query) => query.from <= query.to, {
    error: 'The end date is before the start date',
    path: ['to'],
  })
  .refine(
    (query) => Date.parse(query.to) - Date.parse(query.from) <= MAX_REPORT_DAYS * 86_400_000,
    { error: `Choose at most ${MAX_REPORT_DAYS} days`, path: ['to'] },
  );

const share = z.object({ part: z.number().int(), total: z.number().int() });

export const reportSchema = z.object({
  /** Cohorts starting in the period. */
  occupancy: z.object({
    cohorts: z.number().int(),
    seatsTaken: z.number().int(),
    capacity: z.number().int(),
    byCourse: z.array(
      z.object({
        courseId: idSchema,
        title: z.string(),
        cohorts: z.number().int(),
        seatsTaken: z.number().int(),
        capacity: z.number().int(),
      }),
    ),
  }),
  /** Money moved in the period, per currency and never converted. */
  money: z.array(
    z.object({
      currency: currencySchema,
      paidMinor: z.number().int(),
      refundedMinor: z.number().int(),
    }),
  ),
  /** Of the waiting-list offers made in the period, those that were paid. */
  waitlist: share,
  /** Of the submissions for deadlines in the period, those on time. */
  homeworkOnTime: share,
  certificatesIssued: z.number().int(),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type Report = z.infer<typeof reportSchema>;
