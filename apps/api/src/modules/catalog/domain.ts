import { type CatalogCohort, type Lesson } from '@school/shared/schemas/catalog';
import { type Currency } from '@school/shared/money/money';

export type CohortRow = {
  readonly cohort_id: string;
  readonly course_id: string;
  readonly title: string;
  readonly direction: string;
  readonly school_name: string;
  readonly start_date: Date;
  readonly starts_at: Date;
  readonly time_zone: string;
  readonly price_minor: number;
  readonly currency: Currency;
  readonly capacity: number;
  readonly free_seats: number;
};

export const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

export const toCatalogCohort = (row: CohortRow): CatalogCohort => ({
  cohortId: row.cohort_id,
  courseId: row.course_id,
  title: row.title,
  direction: row.direction,
  schoolName: row.school_name,
  startDate: isoDate(row.start_date),
  startsAt: row.starts_at.toISOString(),
  timeZone: row.time_zone,
  priceMinor: row.price_minor,
  currency: row.currency,
  capacity: row.capacity,
  freeSeats: row.free_seats,
});

export const toLesson = (lesson: {
  readonly id: string;
  readonly seq: number;
  readonly localDate: Date;
  readonly localTime: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}): Lesson => ({
  id: lesson.id,
  seq: lesson.seq,
  localDate: isoDate(lesson.localDate),
  localTime: lesson.localTime,
  startsAt: lesson.startsAt.toISOString(),
  endsAt: lesson.endsAt.toISOString(),
});

/** Makes a search term literal inside a LIKE pattern. */
export const likePattern = (term: string): string =>
  `%${term.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
