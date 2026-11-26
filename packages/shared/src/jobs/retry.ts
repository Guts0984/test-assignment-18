import { type Job } from './job';
import { jobId, QUEUES, type QueueName } from './registry';

const PAYLOAD_KEYS: Readonly<Record<QueueName, string>> = {
  'hold-expiry': 'enrollmentId',
  'waitlist-offers': 'cohortId',
  'payment-notifications': 'notificationId',
  refunds: 'refundRequestId',
  'lesson-reminders': 'notificationId',
  'deadline-reminders': 'notificationId',
  certificates: 'enrollmentId',
  emails: 'emailId',
};

/** The record a job works on, which identifies it across retries. */
export const recordOf = (queue: QueueName, payload: Readonly<Record<string, unknown>>): string =>
  String(payload[PAYLOAD_KEYS[queue]]);

/** A job to run now, built again from a stored failure. */
export const retryJob = (queue: QueueName, payload: unknown): Job => {
  const parsed = QUEUES[queue].payload.parse(payload) as Record<string, string>;
  return {
    queue,
    id: jobId(queue, recordOf(queue, parsed), 'retry'),
    payload: parsed,
    runAt: null,
  } as Job;
};
