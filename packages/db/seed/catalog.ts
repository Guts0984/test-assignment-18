import { type Tx } from '../src/client';
import { LESSONS_PER_COHORT, SCHOOL_COUNT, type SeedSizes } from './sizes';

/**
 * Bulk cohort `c` (from 0) belongs to course `c % courses`. Cohorts of a course whose round
 * differs by three share a currency, which is what makes seeded transfers valid.
 */
export const seedCatalog = async (tx: Tx, sizes: SeedSizes, now: Date): Promise<void> => {
  await tx.$executeRawUnsafe(
    `INSERT INTO courses (id, school_id, title, direction, description, created_at)
     SELECT md5('course-' || n)::uuid, md5('school-' || (1 + n % $2::int))::uuid,
            (ARRAY['Practical','Advanced','Intensive','Applied','Modern'])[1 + n % 5] || ' ' ||
            (ARRAY['TypeScript','Python','Product Design','Data Analysis','QA Automation',
                   'DevOps','Digital Marketing','Project Management','React','SQL','Go'])[1 + n % 11]
            || ' ' || n,
            (ARRAY['programming','design','data','testing','management','marketing'])[1 + n % 6],
            'A cohort-based course with live lessons and reviewed homework.', $3
       FROM generate_series(0, $1::int - 1) n`,
    sizes.courses,
    SCHOOL_COUNT,
    now,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO cohorts (id, course_id, school_id, mentor_id, start_date, time_zone,
                          price_minor, currency, lesson_minutes, starts_at, ends_at,
                          completed_at, created_at)
     SELECT md5('cohort-' || c)::uuid, md5('course-' || course)::uuid,
            md5('school-' || school)::uuid,
            md5('mentor-' || school || '-' || (1 + (c / $3::int) % $4::int))::uuid,
            start_date, tz,
            (ARRAY[800000, 24000, 29000])[1 + currency_no] + (course % 20) * 500,
            (ARRAY['UAH','EUR','USD'])[1 + currency_no], 90,
            (start_date + time '19:00') AT TIME ZONE tz,
            ends_at, CASE WHEN ends_at <= $5::timestamptz THEN ends_at END,
            LEAST(((start_date - 90) + time '12:00') AT TIME ZONE tz, $5::timestamptz)
       FROM (
         SELECT c, c % $2::int AS course, 1 + (c % $2::int) % $3::int AS school,
                (c / $2::int) % 3 AS currency_no, d.start_date, d.tz,
                ((d.start_date + 7 * ($6::int - 1) + time '20:30') AT TIME ZONE d.tz) AS ends_at
           FROM generate_series(0, $1::int - 1) c,
           LATERAL (SELECT ($5::timestamptz)::date - 730 + ((c * 37) % 911) AS start_date,
                           (ARRAY['Europe/Kyiv','Europe/Warsaw','America/New_York'])[1 + c % 3] AS tz
                   ) d
       ) x`,
    sizes.bulkCohorts,
    sizes.courses,
    SCHOOL_COUNT,
    sizes.mentorsPerSchool,
    now,
    LESSONS_PER_COHORT,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO lessons (id, cohort_id, seq, local_date, local_time, starts_at, ends_at)
     SELECT md5('lesson-' || c.id || '-' || s)::uuid, c.id, s,
            c.start_date + 7 * (s - 1), '19:00',
            (c.start_date + 7 * (s - 1) + time '19:00') AT TIME ZONE c.time_zone,
            (c.start_date + 7 * (s - 1) + time '20:30') AT TIME ZONE c.time_zone
       FROM cohorts c, generate_series(1, $1::int) s`,
    LESSONS_PER_COHORT,
  );
};

/** Homework and pending reminders for every lesson, bulk and hand-shaped alike. */
export const seedLessonWork = async (tx: Tx, now: Date): Promise<void> => {
  await tx.$executeRawUnsafe(
    `INSERT INTO homeworks (id, lesson_id, cohort_id, title, deadline_at)
     SELECT md5('homework-' || l.id)::uuid, l.id, l.cohort_id, 'Homework ' || l.seq,
            (l.local_date + 7 + time '23:59:59.999') AT TIME ZONE c.time_zone
       FROM lessons l JOIN cohorts c ON c.id = l.cohort_id`,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO scheduled_notifications (id, kind, lesson_id, lesson_version, due_at)
     SELECT gen_random_uuid(), k.kind, l.id, l.version,
            CASE k.kind WHEN 'lesson_24h' THEN l.starts_at - interval '24 hours'
                        WHEN 'lesson_1h' THEN l.starts_at - interval '1 hour'
                        ELSE h.deadline_at - interval '24 hours' END
       FROM lessons l JOIN homeworks h ON h.lesson_id = l.id,
            (VALUES ('lesson_24h'), ('lesson_1h'), ('deadline_24h')) k(kind)
      WHERE CASE k.kind WHEN 'lesson_24h' THEN l.starts_at - interval '24 hours'
                        WHEN 'lesson_1h' THEN l.starts_at - interval '1 hour'
                        ELSE h.deadline_at - interval '24 hours' END > $1::timestamptz`,
    now,
  );
};
