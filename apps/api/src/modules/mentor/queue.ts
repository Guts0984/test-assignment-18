import { type Db, Prisma } from '@school/db/client';

export type QueueRow = {
  readonly submission_id: string;
  readonly course_title: string;
  readonly student_name: string;
  readonly homework_title: string;
  readonly submitted_at: Date;
  readonly is_late: boolean;
};

export const toQueueItem = (row: QueueRow) => ({
  submissionId: row.submission_id,
  courseTitle: row.course_title,
  studentName: row.student_name,
  homeworkTitle: row.homework_title,
  submittedAt: row.submitted_at.toISOString(),
  isLate: row.is_late,
});

/** Work of students who still study: whoever cancelled or moved away waits for nobody. */
const studying = (submission: Prisma.Sql) => Prisma.sql`EXISTS (
  SELECT 1 FROM enrollments e
   WHERE e.id = ${submission}.enrollment_id AND e.status IN ('paid', 'completed'))`;

const select = (condition: Prisma.Sql, tail: Prisma.Sql) => Prisma.sql`
  SELECT s.id AS submission_id, co.title AS course_title, u.full_name AS student_name,
         h.title AS homework_title, s.submitted_at, s.is_late
    FROM submissions s
    JOIN cohorts c ON c.id = s.cohort_id
    JOIN courses co ON co.id = c.course_id
    JOIN homeworks h ON h.id = s.homework_id
    JOIN users u ON u.id = s.student_id
   WHERE ${condition}
   ORDER BY s.submitted_at, s.id ${tail}`;

/** Waiting work of the mentor's cohorts, oldest first. */
export const waitingWork = (
  db: Db,
  mentorId: string,
  page: { readonly limit: number; readonly offset: number },
): Promise<QueueRow[]> => {
  // The page is chosen first, then dressed up, so the joins touch only a few rows.
  return db.$queryRaw<QueueRow[]>(
    select(
      Prisma.sql`s.id IN (
        SELECT q.id FROM submissions q JOIN cohorts qc ON qc.id = q.cohort_id
         WHERE qc.mentor_id = ${mentorId}::uuid AND q.status = 'submitted'
           AND ${studying(Prisma.sql`q`)}
         ORDER BY q.submitted_at, q.id LIMIT ${page.limit} OFFSET ${page.offset})`,
      Prisma.empty,
    ),
  );
};

export const countWaitingWork = async (db: Db, mentorId: string): Promise<number> => {
  const [row] = await db.$queryRaw<{ total: number }[]>`
    SELECT count(*)::int AS total
      FROM submissions s JOIN cohorts c ON c.id = s.cohort_id
     WHERE c.mentor_id = ${mentorId}::uuid AND s.status = 'submitted'
       AND ${studying(Prisma.sql`s`)}`;
  return row?.total ?? 0;
};

export const claimedWork = (db: Db, mentorId: string): Promise<QueueRow[]> =>
  db.$queryRaw<QueueRow[]>(
    select(Prisma.sql`s.reviewer_id = ${mentorId}::uuid AND s.status = 'in_review'`, Prisma.empty),
  );
