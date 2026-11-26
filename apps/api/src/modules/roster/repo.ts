import { type Db, Prisma } from '@school/db/client';
import { likePattern } from '../catalog/domain';

export type MoneyRow = {
  readonly id: string;
  readonly enrollment_id: string;
  readonly full_name: string;
  readonly kind: 'payment' | 'refund' | 'transfer_out' | 'transfer_in' | 'refund_pending';
  readonly amount_minor: bigint;
  readonly currency: 'UAH' | 'EUR' | 'USD';
  readonly at: Date;
  readonly total: number;
};

/** Money movements of a cohort, plus refunds still on their way, newest first. */
export const cohortMoney = (
  db: Db,
  cohortId: string,
  page: { readonly limit: number; readonly offset: number },
): Promise<MoneyRow[]> => db.$queryRaw<MoneyRow[]>`
  SELECT m.*, count(*) OVER ()::int AS total FROM (
    SELECT o.id, o.enrollment_id, u.full_name, o.kind, o.amount_minor, o.currency,
           o.created_at AS at
      FROM money_operations o
      JOIN enrollments e ON e.id = o.enrollment_id
      JOIN users u ON u.id = e.student_id
     WHERE e.cohort_id = ${cohortId}::uuid
    UNION ALL
    SELECT r.id, r.enrollment_id, u.full_name, 'refund_pending', r.amount_minor, r.currency,
           r.created_at
      FROM refund_requests r
      JOIN enrollments e ON e.id = r.enrollment_id
      JOIN users u ON u.id = e.student_id
     WHERE e.cohort_id = ${cohortId}::uuid AND r.status = 'pending'
  ) m
  ORDER BY m.at DESC, m.id
  LIMIT ${page.limit} OFFSET ${page.offset}`;

export type SearchRow = {
  readonly id: string;
  readonly full_name: string;
  readonly email: string;
  readonly total: number;
};

/** Students with any enrollment in the school, found by part of the name or e-mail. */
export const searchStudents = (
  db: Db,
  input: {
    readonly schoolId: string;
    readonly q: string;
    readonly limit: number;
    readonly offset: number;
  },
): Promise<SearchRow[]> => {
  const pattern = likePattern(input.q);
  const matching = Prisma.sql`(lower(u.full_name) LIKE ${pattern} OR u.email LIKE ${pattern})`;
  return db.$queryRaw<SearchRow[]>`
    SELECT u.id, u.full_name, u.email, count(*) OVER ()::int AS total
      FROM users u
     WHERE u.role = 'student' AND ${matching}
       AND EXISTS (SELECT 1 FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
                    WHERE e.student_id = u.id AND c.school_id = ${input.schoolId}::uuid)
     ORDER BY u.full_name, u.id
     LIMIT ${input.limit} OFFSET ${input.offset}`;
};
