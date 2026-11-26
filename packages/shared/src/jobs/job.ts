import { jobId, type JobPayload, type QueueName } from './registry';

/** A job to publish once the transaction that needs it has committed. */
export type Job = {
  readonly [Q in QueueName]: {
    readonly queue: Q;
    readonly id: string;
    readonly payload: JobPayload<Q>;
    /** Null runs as soon as possible. */
    readonly runAt: Date | null;
  };
}[QueueName];

export const holdExpiryJob = (enrollmentId: string, expiresAt: Date): Job => ({
  queue: 'hold-expiry',
  id: jobId('hold-expiry', enrollmentId, expiresAt.getTime()),
  payload: { enrollmentId },
  runAt: expiresAt,
});

export const notificationJob = (notificationId: string): Job => ({
  queue: 'payment-notifications',
  id: jobId('payment-notifications', notificationId),
  payload: { notificationId },
  runAt: null,
});

export const refundJob = (refundRequestId: string): Job => ({
  queue: 'refunds',
  id: jobId('refunds', refundRequestId),
  payload: { refundRequestId },
  runAt: null,
});

export const emailJob = (emailId: string): Job => ({
  queue: 'emails',
  id: jobId('emails', emailId),
  payload: { emailId },
  runAt: null,
});

export const certificateJob = (enrollmentId: string): Job => ({
  queue: 'certificates',
  id: jobId('certificates', enrollmentId),
  payload: { enrollmentId },
  runAt: null,
});

export const waitlistJob = (cohortId: string): Job => ({
  queue: 'waitlist-offers',
  id: jobId('waitlist-offers', cohortId),
  payload: { cohortId },
  runAt: null,
});

export const scheduledReminderJob = (
  queue: 'lesson-reminders' | 'deadline-reminders',
  notificationId: string,
  dueAt: Date,
): Job => ({
  queue,
  id: jobId(queue, notificationId),
  payload: { notificationId },
  runAt: dueAt,
});
