import { type Tx } from '../src/client';
import { type SeedSizes } from './sizes';

/**
 * Certificate holders get every homework accepted (one in three keeps one returned, still above
 * 80 %). Everyone else has at most three accepted, so no worker issues extra certificates.
 */
export const seedHomework = async (tx: Tx, sizes: SeedSizes, now: Date): Promise<void> => {
  await tx.$executeRawUnsafe(
    `CREATE TEMP TABLE holders ON COMMIT DROP AS
     SELECT e.id, e.student_id, e.cohort_id, c.course_id, c.ends_at, c.mentor_id
       FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
      WHERE e.status = 'completed'
      ORDER BY md5(e.id::text) LIMIT $1::int`,
    sizes.certificates,
  );
  await tx.$executeRawUnsafe(
    `CREATE TEMP TABLE work ON COMMIT DROP AS
     SELECT pg_temp.seed_uuid('submission-' || e.id || '-' || h.id) AS id, h.id AS homework_id,
            e.id AS enrollment_id, e.student_id, e.cohort_id, c.mentor_id, h.deadline_at,
            CASE WHEN l.seq = 6 AND abs(hashtext(e.id::text)) % 3 = 0
                 THEN 'returned' ELSE 'accepted' END AS status,
            LEAST(h.deadline_at - make_interval(hours => 1 + l.seq * 7), $1::timestamptz)
              AS submitted_at
       FROM holders s
       JOIN enrollments e ON e.id = s.id
       JOIN cohorts c ON c.id = e.cohort_id
       JOIN homeworks h ON h.cohort_id = e.cohort_id
       JOIN lessons l ON l.id = h.lesson_id`,
    now,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO work
     SELECT pg_temp.seed_uuid('submission-' || e.id || '-' || h.id), h.id, e.id, e.student_id,
            e.cohort_id, c.mentor_id, h.deadline_at,
            CASE
              WHEN l.seq <= 3 AND x.roll < 60 THEN 'accepted'
              WHEN x.roll < 75 THEN 'returned'
              ELSE 'submitted'
            END,
            LEAST(CASE WHEN x.roll % 10 = 0 THEN h.deadline_at + interval '1 day'
                       ELSE h.deadline_at - interval '2 days' END,
                  $1::timestamptz - make_interval(mins => 1 + x.roll))
       FROM enrollments e
       JOIN cohorts c ON c.id = e.cohort_id
       JOIN homeworks h ON h.cohort_id = e.cohort_id
       JOIN lessons l ON l.id = h.lesson_id AND l.starts_at < $1::timestamptz
       CROSS JOIN LATERAL (SELECT abs(hashtext(e.id::text || h.id::text)) % 100 AS roll) x
      WHERE e.status IN ('paid', 'completed')
        AND NOT EXISTS (SELECT 1 FROM holders s WHERE s.id = e.id)
      ORDER BY (e.status = 'paid') DESC, md5(e.id::text || h.id::text)
      LIMIT GREATEST(0, $2::int - (SELECT count(*) FROM work))`,
    now,
    sizes.submissions,
  );
  // Up to two works per mentor are in review, below the limit of five.
  await tx.$executeRawUnsafe(`
    UPDATE work w SET status = 'in_review'
      FROM (SELECT id, row_number() OVER (PARTITION BY mentor_id ORDER BY id) AS n
              FROM work WHERE status = 'submitted') r
     WHERE w.id = r.id AND r.n <= 2`);
  await tx.$executeRawUnsafe(`
    INSERT INTO submissions (id, homework_id, enrollment_id, student_id, cohort_id, status,
                             body, submitted_at, is_late, reviewer_id, claimed_at)
    SELECT id, homework_id, enrollment_id, student_id, cohort_id, status,
           'Solution is attached in the repository linked in this answer.', submitted_at,
           submitted_at > deadline_at,
           CASE WHEN status = 'in_review' THEN mentor_id END,
           CASE WHEN status = 'in_review' THEN submitted_at END
      FROM work`);
  await tx.$executeRawUnsafe(
    `INSERT INTO submission_reviews (id, submission_id, mentor_id, verdict, score, comment,
                                     reviewed_at)
     SELECT gen_random_uuid(), id, mentor_id, status,
            CASE WHEN status = 'accepted' THEN 70 + abs(hashtext(id::text)) % 31 END,
            CASE WHEN status = 'accepted' THEN 'Well done.'
                 ELSE 'Please address the remarks and resubmit.' END,
            LEAST(submitted_at + interval '1 day', $1::timestamptz)
       FROM work WHERE status IN ('accepted', 'returned')`,
    now,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO certificates (id, course_id, enrollment_id, student_id, number, verify_token,
                               issued_at)
     SELECT gen_random_uuid(), course_id, id, student_id,
            row_number() OVER (PARTITION BY course_id ORDER BY ends_at, id),
            replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
            LEAST(ends_at + interval '1 hour', $1::timestamptz)
       FROM holders`,
    now,
  );
  await tx.$executeRawUnsafe(`
    INSERT INTO certificate_counters (course_id, last_number)
    SELECT course_id, max(number) FROM certificates GROUP BY course_id`);
};
