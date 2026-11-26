import { z } from 'zod';

const id = z.uuid();

/**
 * Every background queue. The description fields are copied into the README by
 * `scripts/readme.mjs`, and CI fails when the two differ.
 */
export const QUEUES = {
  'hold-expiry': {
    payload: z.strictObject({ enrollmentId: id }),
    enqueued: 'When a hold or a waitlist offer is created, delayed until it expires',
    dedup: 'Job id per enrollment and expiry time; expiry only moves held or offered rows',
  },
  'waitlist-offers': {
    payload: z.strictObject({ cohortId: id }),
    enqueued:
      'By the sweeper when a cohort has free seats and waiting students (a freed seat is normally offered inside the transaction that frees it)',
    dedup: 'Allocation locks the cohort row and offers only free seats',
  },
  'payment-notifications': {
    payload: z.strictObject({ notificationId: id }),
    enqueued: 'When a signed payment or refund notification is stored',
    dedup: 'Unique provider event id; a processed notification is skipped',
  },
  refunds: {
    payload: z.strictObject({ refundRequestId: id }),
    enqueued: 'When a refund request is created',
    dedup: 'Idempotency key sent to the gateway; one refund operation per request',
  },
  'lesson-reminders': {
    payload: z.strictObject({ notificationId: id }),
    enqueued: 'By the sweeper when a reminder falls due, 24 h and 1 h before a lesson',
    dedup: 'One row per lesson, kind and lesson version; unique email key per student',
  },
  'deadline-reminders': {
    payload: z.strictObject({ notificationId: id }),
    enqueued: 'By the sweeper when a reminder falls due, 24 h before a homework deadline',
    dedup: 'One row per homework, kind and version; unique email key per student',
  },
  certificates: {
    payload: z.strictObject({ enrollmentId: id }),
    enqueued: 'When a cohort ends, or homework is accepted after it ended',
    dedup: 'Unique certificate per enrollment; number taken in the same transaction',
  },
  emails: {
    payload: z.strictObject({ emailId: id }),
    enqueued: 'When an email is written to the outbox',
    dedup: 'Unique dedupe key; a row is claimed with a lease before sending',
  },
} as const;

export type QueueName = keyof typeof QUEUES;
export type JobPayload<Q extends QueueName> = z.infer<(typeof QUEUES)[Q]['payload']>;
export const QUEUE_NAMES = Object.keys(QUEUES) as [QueueName, ...QueueName[]];

/**
 * A deterministic job id, so re-enqueueing the same work is a no-op while the job exists.
 * BullMQ forbids `:` in custom ids.
 */
export const jobId = (queue: QueueName, ...parts: readonly (string | number)[]): string =>
  [queue, ...parts].join('_').replaceAll(':', '-');
