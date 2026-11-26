import { type QueueName } from '@school/shared/jobs/registry';
import { type Db, type Tx } from '../client';

export type Failure = {
  readonly queue: QueueName;
  /** The record the job works on; it identifies the job across retries and restarts. */
  readonly key: string;
  readonly payload: Readonly<Record<string, string>>;
  readonly error: string;
  readonly attempts: number;
  readonly at: Date;
};

/** The school a job belongs to, found through the record it works on. */
const schoolOfJob = async (db: Db, queue: QueueName, key: string): Promise<string | null> => {
  const rows = await db.$queryRawUnsafe<{ school_id: string | null }[]>(SCHOOL_QUERIES[queue], key);
  return rows[0]?.school_id ?? null;
};

const BY_ENROLLMENT = `SELECT c.school_id FROM enrollments e JOIN cohorts c ON c.id = e.cohort_id
  WHERE e.id = $1::uuid`;
const BY_NOTIFICATION = `SELECT co.school_id FROM scheduled_notifications n
  JOIN lessons l ON l.id = n.lesson_id JOIN cohorts co ON co.id = l.cohort_id
  WHERE n.id = $1::uuid`;

const SCHOOL_QUERIES: Readonly<Record<QueueName, string>> = {
  'hold-expiry': BY_ENROLLMENT,
  certificates: BY_ENROLLMENT,
  'waitlist-offers': 'SELECT school_id FROM cohorts WHERE id = $1::uuid',
  'payment-notifications': 'SELECT school_id FROM payment_notifications WHERE id = $1::uuid',
  refunds: `SELECT c.school_id FROM refund_requests r JOIN enrollments e ON e.id = r.enrollment_id
    JOIN cohorts c ON c.id = e.cohort_id WHERE r.id = $1::uuid`,
  'lesson-reminders': BY_NOTIFICATION,
  'deadline-reminders': BY_NOTIFICATION,
  emails: 'SELECT school_id FROM email_outbox WHERE id = $1::uuid',
};

/** Records a job that used up its attempts. It stays until it succeeds or is retried. */
export const recordFailure = async (db: Db, failure: Failure): Promise<void> => {
  const data = {
    payload: { ...failure.payload },
    error: failure.error.slice(0, 2_000),
    attempts: failure.attempts,
    failedAt: failure.at,
    resolvedAt: null,
  };
  const identity = { queue: failure.queue, jobId: failure.key };
  await db.jobFailure.upsert({
    where: { queue_jobId: identity },
    create: {
      ...identity,
      ...data,
      schoolId: await schoolOfJob(db, failure.queue, failure.key),
    },
    update: data,
  });
};

export const resolveFailures = async (
  db: Db | Tx,
  queue: QueueName,
  key: string,
  at: Date,
): Promise<void> => {
  await db.jobFailure.updateMany({
    where: { queue, jobId: key, resolvedAt: null },
    data: { resolvedAt: at },
  });
};
