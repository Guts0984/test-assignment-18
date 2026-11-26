import { type Db, Prisma } from '@school/db/client';
import { type CatalogQuery } from '@school/shared/schemas/catalog';
import { type CohortRow, likePattern } from '../domain';

type Filter = Partial<CatalogQuery> & { readonly now: Date; readonly courseId?: string };

const conditions = (filter: Filter): Prisma.Sql => {
  const parts = [Prisma.sql`c.starts_at > ${filter.now}`];
  if (filter.courseId) parts.push(Prisma.sql`c.course_id = ${filter.courseId}::uuid`);
  if (filter.q) parts.push(Prisma.sql`lower(co.title) LIKE ${likePattern(filter.q)}`);
  if (filter.direction) parts.push(Prisma.sql`co.direction = ${filter.direction}`);
  if (filter.startFrom) parts.push(Prisma.sql`c.start_date >= ${filter.startFrom}::date`);
  if (filter.startTo) parts.push(Prisma.sql`c.start_date <= ${filter.startTo}::date`);
  if (filter.currency) parts.push(Prisma.sql`c.currency = ${filter.currency}`);
  if (filter.priceMin !== undefined) parts.push(Prisma.sql`c.price_minor >= ${filter.priceMin}`);
  if (filter.priceMax !== undefined) parts.push(Prisma.sql`c.price_minor <= ${filter.priceMax}`);
  return Prisma.join(parts, ' AND ');
};

/** Cohorts that have not started, soonest first. Waiting students come before free seats. */
export const findOpenCohorts = (
  db: Db,
  filter: Filter,
  page: { readonly limit: number; readonly offset: number },
): Promise<CohortRow[]> => db.$queryRaw<CohortRow[]>`
  SELECT c.id AS cohort_id, co.id AS course_id, co.title, co.direction, s.name AS school_name,
         c.start_date, c.starts_at, c.time_zone, c.price_minor, c.currency, c.capacity,
         GREATEST(0, c.capacity - c.seats_taken - (
           SELECT count(*) FROM waitlist_entries w
            WHERE w.cohort_id = c.id AND w.status = 'waiting'))::int AS free_seats
    FROM cohorts c
    JOIN courses co ON co.id = c.course_id
    JOIN schools s ON s.id = c.school_id
   WHERE ${conditions(filter)}
   ORDER BY c.starts_at, c.id
   LIMIT ${page.limit} OFFSET ${page.offset}`;

export const countOpenCohorts = async (db: Db, filter: Filter): Promise<number> => {
  const [row] = await db.$queryRaw<{ total: number }[]>`
    SELECT count(*)::int AS total
      FROM cohorts c JOIN courses co ON co.id = c.course_id
     WHERE ${conditions(filter)}`;
  return row?.total ?? 0;
};
