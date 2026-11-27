import { type Db, Prisma } from '@school/db/client';
import { type ReportQuery } from '@school/shared/schemas/report';

export type Filter = ReportQuery & { readonly schoolId: string };

/** Cohort conditions shared by every metric; `c` is the cohort. */
const scope = (filter: Filter): Prisma.Sql => {
  const parts = [Prisma.sql`c.school_id = ${filter.schoolId}::uuid`];
  if (filter.courseId) parts.push(Prisma.sql`c.course_id = ${filter.courseId}::uuid`);
  if (filter.cohortId) parts.push(Prisma.sql`c.id = ${filter.cohortId}::uuid`);
  if (filter.currency) parts.push(Prisma.sql`c.currency = ${filter.currency}`);
  return Prisma.join(parts, ' AND ');
};

/** Instants of the period in UTC days, the end day included. */
const between = (column: Prisma.Sql, filter: Filter): Prisma.Sql => Prisma.sql`
  ${column} >= (${filter.from}::date::timestamp AT TIME ZONE 'UTC')
  AND ${column} < ((${filter.to}::date + 1)::timestamp AT TIME ZONE 'UTC')`;

export const occupancy = (db: Db, filter: Filter) => db.$queryRaw<
  { course_id: string; title: string; cohorts: number; taken: number; capacity: number }[]
>`
  SELECT co.id AS course_id, co.title, count(*)::int AS cohorts,
         sum(c.seats_taken)::int AS taken, sum(c.capacity)::int AS capacity
    FROM cohorts c JOIN courses co ON co.id = c.course_id
   WHERE ${scope(filter)} AND c.start_date BETWEEN ${filter.from}::date AND ${filter.to}::date
   GROUP BY co.id, co.title ORDER BY co.title, co.id`;

export const money = (db: Db, filter: Filter) => db.$queryRaw<
  { currency: 'UAH' | 'EUR' | 'USD'; paid: bigint; refunded: bigint }[]
>`
  SELECT o.currency,
         coalesce(sum(o.amount_minor) FILTER (WHERE o.kind = 'payment'), 0)::bigint AS paid,
         coalesce(sum(o.amount_minor) FILTER (WHERE o.kind = 'refund'), 0)::bigint AS refunded
    FROM money_operations o
    JOIN cohorts c ON c.id = o.cohort_id
   WHERE o.kind IN ('payment', 'refund') AND ${between(Prisma.sql`o.created_at`, filter)}
     AND ${scope(filter)}
   GROUP BY o.currency ORDER BY o.currency`;

export const waitlistConversion = (db: Db, filter: Filter) => db.$queryRaw<
  { part: number; total: number }[]
>`
  SELECT count(*) FILTER (WHERE w.status = 'converted')::int AS part, count(*)::int AS total
    FROM waitlist_entries w JOIN cohorts c ON c.id = w.cohort_id
   WHERE ${between(Prisma.sql`w.offered_at`, filter)} AND ${scope(filter)}`;

export const homeworkOnTime = (db: Db, filter: Filter) => db.$queryRaw<
  { part: number; total: number }[]
>`
  SELECT coalesce(sum(t.on_time), 0)::int AS part, coalesce(sum(t.total), 0)::int AS total
    FROM homeworks h
    JOIN cohorts c ON c.id = h.cohort_id
    CROSS JOIN LATERAL (
      SELECT count(*) AS total, count(*) FILTER (WHERE NOT s.is_late) AS on_time
        FROM submissions s WHERE s.homework_id = h.id) t
   WHERE ${between(Prisma.sql`h.deadline_at`, filter)} AND ${scope(filter)}`;

export const certificatesIssued = (db: Db, filter: Filter) => db.$queryRaw<{ total: number }[]>`
  SELECT count(*)::int AS total
    FROM certificates x
    JOIN cohorts c ON c.id = x.cohort_id
   WHERE ${between(Prisma.sql`x.issued_at`, filter)} AND ${scope(filter)}`;
