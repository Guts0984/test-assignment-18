import { type Db, type Prisma } from '@school/db/client';
import { type Currency } from '@school/shared/money/money';
import { type EnrollmentView } from '@school/shared/schemas/enrollment';
import { type EnrollmentStatus } from '@school/shared/status/enrollment';
import { isoDate } from '../catalog/domain';

const INCLUDE = {
  cohort: { include: { course: true } },
  redemption: { include: { promo: true } },
} satisfies Prisma.EnrollmentInclude;

type Row = Prisma.EnrollmentGetPayload<{ include: typeof INCLUDE }>;

export const toEnrollmentView = (row: Row, now: Date): EnrollmentView => ({
  id: row.id,
  cohortId: row.cohortId,
  courseId: row.cohort.courseId,
  courseTitle: row.cohort.course.title,
  startDate: isoDate(row.cohort.startDate),
  startsAt: row.cohort.startsAt.toISOString(),
  timeZone: row.cohort.timeZone,
  status: row.status as EnrollmentStatus,
  listPriceMinor: row.listPriceMinor,
  priceMinor: row.priceMinor,
  currency: row.currency as Currency,
  paidMinor: Number(row.balanceMinor),
  holdExpiresAt:
    row.status === 'held' || row.status === 'offered'
      ? (row.holdExpiresAt?.toISOString() ?? null)
      : null,
  serverNow: now.toISOString(),
  promoCode:
    row.redemption && row.redemption.state !== 'released' ? row.redemption.promo.code : null,
  transferFromId: row.transferFromId,
});

/** The enrollments of one student; ownership is part of the query itself. */
export const findOwnEnrollments = (db: Db, studentId: string, id?: string) =>
  db.enrollment.findMany({
    where: { studentId, ...(id === undefined ? {} : { id }) },
    include: INCLUDE,
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
