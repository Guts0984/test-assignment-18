import {
  certificateJob,
  emailJob,
  holdExpiryJob,
  notificationJob,
  refundJob,
  scheduledReminderJob,
  waitlistJob,
  type Job,
} from '@school/shared/jobs/job';
import { type Db } from '../client';

const BATCH = 500;

type Row = { readonly id: string; readonly at: Date | null };

/** Cohorts that have ended and still need closing. */
export const cohortsToComplete = async (db: Db, now: Date): Promise<string[]> => {
  const rows = await db.cohort.findMany({
    where: { completedAt: null, endsAt: { lte: now } },
    select: { id: true },
    orderBy: { endsAt: 'asc' },
    take: BATCH,
  });
  return rows.map((row) => row.id);
};

/**
 * Everything Postgres says should happen now. This is the whole recovery story: whatever Redis
 * lost is found again here. Jobs that used up their attempts are left for a manual retry.
 */
export const findDueJobs = async (db: Db, now: Date, emailLeaseBefore: Date): Promise<Job[]> => {
  const [holds, waiting, notices, refunds, reminders, certificates, emails] = await Promise.all([
    db.$queryRaw<{ id: string; at: Date }[]>`
      SELECT e.id, e.hold_expires_at AS at FROM enrollments e
       WHERE e.status IN ('held', 'offered') AND e.hold_expires_at <= ${now}
         AND NOT EXISTS (SELECT 1 FROM job_failures f WHERE f.queue = 'hold-expiry'
                          AND f.job_id = e.id::text AND f.resolved_at IS NULL)
       ORDER BY e.hold_expires_at LIMIT ${BATCH}`,
    db.$queryRaw<Row[]>`
      SELECT DISTINCT c.id, NULL::timestamptz AS at
        FROM waitlist_entries w JOIN cohorts c ON c.id = w.cohort_id
       WHERE w.status = 'waiting' AND c.capacity > c.seats_taken AND c.starts_at > ${now}
         AND NOT EXISTS (SELECT 1 FROM job_failures f WHERE f.queue = 'waitlist-offers'
                          AND f.job_id = c.id::text AND f.resolved_at IS NULL)
       LIMIT ${BATCH}`,
    db.$queryRaw<Row[]>`
      SELECT n.id, NULL::timestamptz AS at FROM payment_notifications n
       WHERE n.processed_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM job_failures f WHERE f.queue = 'payment-notifications'
                          AND f.job_id = n.id::text AND f.resolved_at IS NULL)
       ORDER BY n.received_at LIMIT ${BATCH}`,
    db.$queryRaw<Row[]>`
      SELECT r.id, NULL::timestamptz AS at FROM refund_requests r
       WHERE r.status = 'pending'
         AND NOT EXISTS (SELECT 1 FROM job_failures f WHERE f.queue = 'refunds'
                          AND f.job_id = r.id::text AND f.resolved_at IS NULL)
       ORDER BY r.created_at LIMIT ${BATCH}`,
    db.$queryRaw<{ id: string; at: Date; kind: string }[]>`
      SELECT n.id, n.due_at AS at, n.kind FROM scheduled_notifications n
       WHERE n.status = 'pending' AND n.due_at <= ${now}
         AND NOT EXISTS (SELECT 1 FROM job_failures f
                          WHERE f.queue IN ('lesson-reminders', 'deadline-reminders')
                            AND f.job_id = n.id::text AND f.resolved_at IS NULL)
       ORDER BY n.due_at LIMIT ${BATCH}`,
    db.$queryRaw<Row[]>`
      SELECT e.id, NULL::timestamptz AS at FROM enrollments e
       WHERE e.certificate_due_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM job_failures f WHERE f.queue = 'certificates'
                          AND f.job_id = e.id::text AND f.resolved_at IS NULL)
       ORDER BY e.certificate_due_at LIMIT ${BATCH}`,
    db.$queryRaw<Row[]>`
      SELECT m.id, NULL::timestamptz AS at FROM email_outbox m
       WHERE (m.status = 'pending' OR (m.status = 'sending' AND m.lease_until < ${emailLeaseBefore}))
         AND NOT EXISTS (SELECT 1 FROM job_failures f WHERE f.queue = 'emails'
                          AND f.job_id = m.id::text AND f.resolved_at IS NULL)
       ORDER BY m.created_at LIMIT ${BATCH}`,
  ]);
  return [
    ...holds.map((row) => holdExpiryJob(row.id, row.at)),
    ...waiting.map((row) => waitlistJob(row.id)),
    ...notices.map((row) => notificationJob(row.id)),
    ...refunds.map((row) => refundJob(row.id)),
    ...reminders.map((row) =>
      scheduledReminderJob(
        row.kind === 'deadline_24h' ? 'deadline-reminders' : 'lesson-reminders',
        row.id,
        row.at,
      ),
    ),
    ...certificates.map((row) => certificateJob(row.id)),
    ...emails.map((row) => emailJob(row.id)),
  ].map((job) => ({ ...job, runAt: null }));
};
