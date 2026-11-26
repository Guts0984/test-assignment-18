import { z } from 'zod';
import { amountMinorSchema, currencySchema } from '../money/money';
import { MAX_LESSONS } from '../schedule/generate';
import { localDateSchema, localTimeSchema, timeZoneSchema } from '../schedule/zoned';
import { idSchema, instantSchema, pageOf, pageShape, text } from './common';
import { lessonSchema } from './catalog';

export const MAX_CAPACITY = 10_000;

export const createCourseSchema = z.strictObject({
  title: text(2, 160),
  direction: text(2, 60),
  description: text(0, 5_000).default(''),
});

export const updateCourseSchema = z
  .strictObject({
    title: text(2, 160).optional(),
    direction: text(2, 60).optional(),
    description: text(0, 5_000).optional(),
  })
  .refine((change) => Object.keys(change).length > 0, { error: 'Nothing to change' });

export const courseSchema = z.object({
  id: idSchema,
  title: z.string(),
  direction: z.string(),
  description: z.string(),
});

export const courseListQuerySchema = z.strictObject({ q: text(0, 100).optional(), ...pageShape });
export const coursePageSchema = pageOf(courseSchema);

/** «по вторникам и четвергам в 19:00 по Киеву, 12 занятий» */
export const scheduleRuleSchema = z.strictObject({
  weekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .refine((days) => new Set(days).size === days.length, { error: 'Weekdays must be unique' }),
  localTime: localTimeSchema,
  count: z.number().int().min(1).max(MAX_LESSONS),
});

export const createCohortSchema = z.strictObject({
  courseId: idSchema,
  mentorId: idSchema,
  startDate: localDateSchema,
  timeZone: timeZoneSchema,
  capacity: z.number().int().min(1).max(MAX_CAPACITY),
  priceMinor: amountMinorSchema,
  currency: currencySchema,
  lessonMinutes: z.number().int().min(15).max(480).default(90),
  schedule: scheduleRuleSchema,
});

export const updateCohortSchema = z
  .strictObject({ mentorId: idSchema.optional(), priceMinor: amountMinorSchema.optional() })
  .refine((change) => Object.keys(change).length > 0, { error: 'Nothing to change' });

export const rescheduleLessonSchema = z.strictObject({
  localDate: localDateSchema,
  localTime: localTimeSchema,
});

export const managerCohortSchema = z.object({
  id: idSchema,
  courseId: idSchema,
  courseTitle: z.string(),
  mentorId: idSchema,
  mentorName: z.string(),
  startDate: localDateSchema,
  startsAt: instantSchema,
  endsAt: instantSchema.nullable(),
  timeZone: z.string(),
  capacity: z.number().int(),
  seatsTaken: z.number().int(),
  priceMinor: z.number().int(),
  currency: currencySchema,
});

export const managerCohortDetailSchema = managerCohortSchema.extend({
  lessons: z.array(lessonSchema),
});

export const cohortListQuerySchema = z.strictObject({
  courseId: idSchema.optional(),
  q: text(0, 100).optional(),
  ...pageShape,
});
export const managerCohortPageSchema = pageOf(managerCohortSchema);

export const mentorOptionsSchema = z.object({
  items: z.array(z.object({ id: idSchema, fullName: z.string() })),
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
export type CreateCohortInput = z.infer<typeof createCohortSchema>;
export type UpdateCohortInput = z.infer<typeof updateCohortSchema>;
export type RescheduleLessonInput = z.infer<typeof rescheduleLessonSchema>;
export type ManagerCohort = z.infer<typeof managerCohortSchema>;
