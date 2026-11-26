import { type Currency } from '@school/shared/money/money';
import { type ManagerCohort } from '@school/shared/schemas/manage';
import { isoDate } from '../catalog/domain';

export const toManagerCohort = (cohort: {
  readonly id: string;
  readonly courseId: string;
  readonly mentorId: string;
  readonly startDate: Date;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly timeZone: string;
  readonly capacity: number;
  readonly seatsTaken: number;
  readonly priceMinor: number;
  readonly currency: string;
  readonly course: { readonly title: string };
  readonly mentor: { readonly fullName: string };
}): ManagerCohort => ({
  id: cohort.id,
  courseId: cohort.courseId,
  courseTitle: cohort.course.title,
  mentorId: cohort.mentorId,
  mentorName: cohort.mentor.fullName,
  startDate: isoDate(cohort.startDate),
  startsAt: cohort.startsAt.toISOString(),
  endsAt: cohort.endsAt?.toISOString() ?? null,
  timeZone: cohort.timeZone,
  capacity: cohort.capacity,
  seatsTaken: cohort.seatsTaken,
  priceMinor: cohort.priceMinor,
  currency: cohort.currency as Currency,
});
