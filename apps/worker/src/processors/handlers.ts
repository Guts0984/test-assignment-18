import { issueCertificate } from '@school/db/repo/certificate';
import { deliverEmail } from '@school/db/repo/email-delivery';
import { expireEnrollment } from '@school/db/repo/expiry';
import { processNotification } from '@school/db/repo/notification';
import { openCohorts } from '@school/db/repo/open-cohorts';
import { deliverRefund } from '@school/db/repo/refund-delivery';
import { processReminder } from '@school/db/repo/reminder';
import { type Unit } from '@school/db/repo/context';
import { runBusiness } from '@school/queue/business';
import { type JobPayload, type QueueName } from '@school/shared/jobs/registry';
import { type WorkerDeps } from '../deps';

const timings = (deps: WorkerDeps) => ({
  holdTtlSec: deps.env.HOLD_TTL_SEC,
  offerTtlSec: deps.env.OFFER_TTL_SEC,
});

const business = <T>(deps: WorkerDeps, work: (unit: Unit) => Promise<T>): Promise<T> =>
  runBusiness({ ...deps, timings: timings(deps) }, work);

type Handlers = {
  readonly [Q in QueueName]: (deps: WorkerDeps, payload: JobPayload<Q>) => Promise<unknown>;
};

const reminder = (deps: WorkerDeps, payload: { notificationId: string }) =>
  business(deps, (unit) => processReminder(unit, payload.notificationId));

/**
 * What each queue does. Every handler is a guarded database transition, so running a job twice,
 * late, early or on two workers at once has the effect of running it once.
 */
export const HANDLERS: Handlers = {
  'hold-expiry': (deps, { enrollmentId }) =>
    business(deps, (unit) => expireEnrollment(unit, enrollmentId)),
  'waitlist-offers': (deps, { cohortId }) =>
    business(deps, async (unit) => {
      await openCohorts(unit, [cohortId]);
    }),
  'payment-notifications': (deps, { notificationId }) =>
    business(deps, (unit) => processNotification(unit, notificationId)),
  refunds: async (deps, { refundRequestId }) => {
    const result = await deliverRefund(
      {
        db: deps.db,
        now: deps.time.now,
        timings: timings(deps),
        encryptionKey: deps.env.GATEWAY_ENCRYPTION_KEY,
        timeoutMs: deps.env.PAYSTUB_HTTP_TIMEOUT_MS,
        callbackUrl: deps.env.WEBHOOK_CALLBACK_URL,
      },
      refundRequestId,
    );
    if (!result.ok) throw new Error(`The payment system did not refund: ${result.error.kind}`);
    if (result.value) await deps.jobs.publish(result.value.jobs);
  },
  'lesson-reminders': reminder,
  'deadline-reminders': reminder,
  certificates: (deps, { enrollmentId }) =>
    business(deps, (unit) => issueCertificate(unit, enrollmentId)),
  emails: async (deps, { emailId }) => {
    const outcome = await deliverEmail(
      deps.db,
      { emailId, now: () => new Date(), leaseMs: deps.env.EMAIL_LEASE_MS },
      deps.mailer.send,
    );
    // Someone else holds it: if they die, the sweeper offers it again after the lease.
    return outcome;
  },
};
