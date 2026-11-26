import { type Cohort, type Enrollment } from '@prisma/client';
import { type Tx } from '../client';

/**
 * Lock order for every writer: cohort rows in ascending id order, then enrollments, then promo
 * codes. `NO KEY UPDATE` serializes writers without blocking foreign key checks.
 */
export const lockCohorts = async (
  tx: Tx,
  ids: readonly string[],
): Promise<ReadonlyMap<string, Cohort>> => {
  const unique = [...new Set(ids)].sort();
  for (const id of unique) {
    await tx.$queryRaw`SELECT id FROM cohorts WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
  }
  const rows = await tx.cohort.findMany({ where: { id: { in: unique } } });
  return new Map(rows.map((row) => [row.id, row]));
};

/** Reads an enrollment again, locked. Take its cohort lock first. */
export const lockEnrollment = async (tx: Tx, id: string): Promise<Enrollment> => {
  await tx.$queryRaw`SELECT id FROM enrollments WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
  return tx.enrollment.findUniqueOrThrow({ where: { id } });
};

export const cohortOf = (cohorts: ReadonlyMap<string, Cohort>, id: string): Cohort => {
  const cohort = cohorts.get(id);
  if (!cohort) throw new Error(`Cohort ${id} was not locked`);
  return cohort;
};
