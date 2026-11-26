import { type Tx } from '../src/client';
import { type SeedSizes } from './sizes';

/** Students of cohort `c` are numbered from `c * STRIDE`, so neighbours never collide. */
const STRIDE = 300;

/**
 * Builds the enrollments in a temporary table first. `fate` is the final status; a
 * transferred row gets a successor in the same course three rounds later.
 */
const buildPlan = async (tx: Tx, sizes: SeedSizes, now: Date): Promise<void> => {
  await tx.$executeRawUnsafe(`
    CREATE TEMP TABLE plan (
      id uuid PRIMARY KEY, cohort_id uuid NOT NULL, student_id uuid NOT NULL,
      fate text NOT NULL, source_id uuid, price int NOT NULL, currency text NOT NULL,
      created_at timestamptz NOT NULL, closed_at timestamptz NOT NULL, finished boolean NOT NULL
    ) ON COMMIT DROP`);
  await tx.$executeRawUnsafe(
    `INSERT INTO plan
     SELECT pg_temp.seed_uuid('enrollment-' || c || '-' || k), co.id,
            pg_temp.seed_uuid('student-' || (1 + (c * $5::int + k) % $3::int)),
            CASE
              WHEN k % 50 < 2 THEN 'refunded'
              WHEN k % 50 < 4 THEN 'cancelled'
              WHEN k % 50 = 4 THEN 'expired'
              WHEN k % 20 = 7 AND c + 3 * $4::int < $1::int THEN 'transferred'
              WHEN k % 25 = 9 THEN 'refunded'
              WHEN co.completed_at IS NULL THEN 'paid'
              ELSE 'completed'
            END,
            NULL, co.price_minor, co.currency, t.created_at,
            t.created_at + interval '1 day', co.completed_at IS NOT NULL
       FROM generate_series(0, $1::int - 1) c
       CROSS JOIN generate_series(0, $2::int - 1) k
       JOIN cohorts co ON co.id = pg_temp.seed_uuid('cohort-' || c)
       CROSS JOIN LATERAL (
         SELECT LEAST(co.starts_at - make_interval(days => 2 + k % 40),
                      $6::timestamptz - interval '3 days') AS created_at) t`,
    sizes.bulkCohorts,
    sizes.enrollmentsPerCohort,
    sizes.students,
    sizes.courses,
    STRIDE,
    now,
  );
  await tx.$executeRawUnsafe(
    `INSERT INTO plan
     SELECT pg_temp.seed_uuid('successor-' || p.id), target.id, p.student_id,
            CASE WHEN target.completed_at IS NULL THEN 'paid' ELSE 'completed' END,
            p.id, p.price, p.currency, p.closed_at, p.closed_at,
            target.completed_at IS NOT NULL
       FROM plan p
       JOIN generate_series(0, $1::int - 1) c ON p.cohort_id = pg_temp.seed_uuid('cohort-' || c)
       JOIN cohorts target ON target.id = pg_temp.seed_uuid('cohort-' || (c + 3 * $2::int))
      WHERE p.fate = 'transferred'`,
    sizes.bulkCohorts,
    sizes.courses,
  );
  await tx.$executeRawUnsafe('ANALYZE plan');
};

const writeEnrollments = async (tx: Tx): Promise<void> => {
  await tx.$executeRawUnsafe(`
    INSERT INTO enrollments (id, cohort_id, student_id, status, list_price_minor, price_minor,
                             currency, hold_expires_at, transfer_from_id, created_at,
                             updated_at, paid_at)
    SELECT id, cohort_id, student_id, fate, price, price, currency,
           created_at + interval '15 minutes', source_id, created_at, closed_at,
           CASE WHEN fate IN ('paid', 'completed', 'refunded', 'transferred')
                THEN created_at + interval '5 minutes' END
      FROM plan
     ORDER BY source_id NULLS FIRST`);
};

const writeCapacityAndJournal = async (tx: Tx): Promise<void> => {
  // Capacity is the occupancy plus 0 to 6 free seats.
  await tx.$executeRawUnsafe(`
    INSERT INTO seat_journal (cohort_id, seats_delta, capacity_delta, reason, actor_kind, at)
    SELECT c.id, 0,
           coalesce(p.occupied, 0) + abs(hashtext(c.id::text)) % 7 + 1, 'capacity', 'manager',
           c.created_at
      FROM cohorts c
      LEFT JOIN (SELECT cohort_id, count(*) FILTER (WHERE fate IN ('paid', 'completed'))
                        AS occupied FROM plan GROUP BY cohort_id) p ON p.cohort_id = c.id
     WHERE EXISTS (SELECT 1 FROM plan x WHERE x.cohort_id = c.id)`);
  // Releases are written first in a separate pass so a counter never exceeds capacity midway.
  await tx.$executeRawUnsafe(`
    INSERT INTO seat_journal (cohort_id, enrollment_id, seats_delta, reason, actor_kind, at)
    SELECT p.cohort_id, p.id, j.delta, j.reason, j.actor, j.at
      FROM plan p
      CROSS JOIN LATERAL (VALUES
        (1, CASE WHEN p.source_id IS NULL THEN 'hold' ELSE 'transfer_in' END,
            'student', p.created_at, true),
        (0, 'payment', 'system', p.created_at + interval '5 minutes',
            p.source_id IS NULL AND p.fate IN ('paid', 'completed', 'refunded', 'transferred')),
        (-1, CASE p.fate WHEN 'expired' THEN 'expiry' WHEN 'transferred' THEN 'transfer_out'
                         ELSE 'cancel' END,
             CASE p.fate WHEN 'expired' THEN 'system' ELSE 'student' END, p.closed_at,
             p.fate IN ('refunded', 'cancelled', 'expired', 'transferred'))
      ) j(delta, reason, actor, at, applies)
     WHERE j.applies`);
};

const writeMoney = async (tx: Tx): Promise<void> => {
  await tx.$executeRawUnsafe(`
    INSERT INTO refund_requests (id, enrollment_id, amount_minor, currency, reason, status,
                                 created_at, completed_at)
    SELECT pg_temp.seed_uuid('refund-' || id), id,
           CASE WHEN abs(hashtext(id::text)) % 2 = 0 THEN price ELSE price / 2 END,
           currency, 'cancel', 'succeeded', closed_at, closed_at + interval '1 minute'
      FROM plan WHERE fate = 'refunded'`);
  await tx.$executeRawUnsafe(`
    INSERT INTO money_operations (id, enrollment_id, kind, amount_minor, currency,
                                  provider_payment_id, refund_request_id, created_at)
    SELECT pg_temp.seed_uuid('payment-' || id), id, 'payment', price, currency, 'seed-' || id, NULL,
           created_at + interval '5 minutes'
      FROM plan
     WHERE source_id IS NULL AND fate IN ('paid', 'completed', 'refunded', 'transferred')
    UNION ALL
    SELECT pg_temp.seed_uuid('refund-op-' || p.id), p.id, 'refund', r.amount_minor, p.currency, NULL,
           r.id, r.completed_at
      FROM plan p JOIN refund_requests r ON r.enrollment_id = p.id
    UNION ALL
    SELECT pg_temp.seed_uuid('transfer-out-' || p.source_id), p.source_id, 'transfer_out', p.price,
           p.currency, NULL, NULL, p.created_at
      FROM plan p WHERE p.source_id IS NOT NULL
    UNION ALL
    SELECT pg_temp.seed_uuid('transfer-in-' || p.id), p.id, 'transfer_in', p.price, p.currency, NULL,
           NULL, p.created_at
      FROM plan p WHERE p.source_id IS NOT NULL`);
  await tx.$executeRawUnsafe(`
    INSERT INTO ledger_entries (operation_id, account, enrollment_id, debit_minor, credit_minor)
    SELECT o.id, side.account, CASE WHEN side.account = 'enrollment' THEN o.enrollment_id END,
           CASE WHEN (o.kind IN ('payment', 'transfer_in')) = (side.account = 'enrollment')
                THEN 0 ELSE o.amount_minor END,
           CASE WHEN (o.kind IN ('payment', 'transfer_in')) = (side.account = 'enrollment')
                THEN o.amount_minor ELSE 0 END
      FROM money_operations o
      CROSS JOIN LATERAL (VALUES ('enrollment'),
        (CASE WHEN o.kind IN ('payment', 'refund') THEN 'gateway' ELSE 'transfer' END)
      ) side(account)`);
  await tx.$executeRawUnsafe(`
    UPDATE enrollments e SET balance_minor = l.balance
      FROM (SELECT enrollment_id, sum(credit_minor - debit_minor) AS balance
              FROM ledger_entries WHERE account = 'enrollment' GROUP BY enrollment_id) l
     WHERE e.id = l.enrollment_id`);
};

/** The search table's trigger is off during the bulk load, so it is filled here. */
const writeSchoolStudents = async (tx: Tx): Promise<void> => {
  await tx.$executeRawUnsafe(`
    INSERT INTO school_students (school_id, student_id, full_name, email)
    SELECT DISTINCT c.school_id, u.id, u.full_name, u.email
      FROM plan p JOIN cohorts c ON c.id = p.cohort_id JOIN users u ON u.id = p.student_id
    ON CONFLICT DO NOTHING`);
};

/** Waitlist history, so conversion reports have data. */
const writeWaitlistHistory = async (tx: Tx): Promise<void> => {
  await tx.$executeRawUnsafe(`
    INSERT INTO waitlist_entries (id, cohort_id, student_id, status, joined_at, offered_at,
                                  enrollment_id)
    SELECT gen_random_uuid(), cohort_id, student_id,
           CASE WHEN fate = 'expired' THEN 'offer_expired' ELSE 'converted' END,
           created_at - interval '3 days', created_at, id
      FROM plan
     WHERE source_id IS NULL
       AND (fate = 'expired' OR (fate = 'completed' AND abs(hashtext(id::text)) % 40 = 0))`);
};

export const seedEnrollments = async (tx: Tx, sizes: SeedSizes, now: Date): Promise<void> => {
  await buildPlan(tx, sizes, now);
  await writeEnrollments(tx);
  await writeSchoolStudents(tx);
  await writeCapacityAndJournal(tx);
  await writeMoney(tx);
  await writeWaitlistHistory(tx);
};
