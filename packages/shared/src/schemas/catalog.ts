import { z } from 'zod';
import { currencySchema, MAX_PRICE_MINOR } from '../money/money';
import { localDateSchema } from '../schedule/zoned';
import { idSchema, instantSchema, pageOf, pageShape, text } from './common';

const price = z.coerce.number().int().min(0).max(MAX_PRICE_MINOR);

export const catalogQuerySchema = z
  .strictObject({
    q: text(0, 100).optional(),
    direction: text(1, 60).optional(),
    startFrom: localDateSchema.optional(),
    startTo: localDateSchema.optional(),
    currency: currencySchema.optional(),
    priceMin: price.optional(),
    priceMax: price.optional(),
    ...pageShape,
  })
  .refine(
    (query) =>
      query.currency !== undefined ||
      (query.priceMin === undefined && query.priceMax === undefined),
    { error: 'Choose a currency to filter by price', path: ['currency'] },
  );

export const catalogCohortSchema = z.object({
  cohortId: idSchema,
  courseId: idSchema,
  title: z.string(),
  direction: z.string(),
  schoolName: z.string(),
  startDate: localDateSchema,
  startsAt: instantSchema,
  timeZone: z.string(),
  priceMinor: z.number().int(),
  currency: currencySchema,
  capacity: z.number().int(),
  /** Seats a new student can book right now. Waiting students have priority. */
  freeSeats: z.number().int().min(0),
});

export const catalogPageSchema = pageOf(catalogCohortSchema);
export const directionsSchema = z.object({ items: z.array(z.string()) });

export const lessonSchema = z.object({
  id: idSchema,
  seq: z.number().int(),
  localDate: localDateSchema,
  localTime: z.string(),
  startsAt: instantSchema,
  endsAt: instantSchema,
});

export const courseDetailSchema = z.object({
  id: idSchema,
  title: z.string(),
  direction: z.string(),
  description: z.string(),
  schoolName: z.string(),
  cohorts: z.array(catalogCohortSchema.extend({ lessons: z.array(lessonSchema) })),
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export type CatalogCohort = z.infer<typeof catalogCohortSchema>;
export type CourseDetail = z.infer<typeof courseDetailSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
