import { randomUUID } from 'node:crypto';
import { sign, SIGNATURE_HEADER } from '@school/gateway/signature';
import { seal } from '@school/gateway/secret-box';
import { processNotification } from '@school/db/repo/notification';
import { expireEnrollment } from '@school/db/repo/expiry';
import { deliverRefund } from '@school/db/repo/refund-delivery';
import { runUnit } from '@school/db/repo/unit-of-work';
import { createCohort } from '@school/db/testing/factories';
import { loadEnv as loadStubEnv } from '@school/paystub/config/env';
import { startStub, type Stub } from '@school/paystub/server';
import { type TestApi } from './app';
import { client, type Reply } from './client';

export const MERCHANT_KEY = 'merchant-key-used-by-tests-0001';

const timings = (api: TestApi) => ({
  holdTtlSec: api.deps.env.HOLD_TTL_SEC,
  offerTtlSec: api.deps.env.OFFER_TTL_SEC,
});

const unitInput = (api: TestApi) => ({ now: api.clock.now(), timings: timings(api) });

export const connectGateway = async (
  api: TestApi,
  schoolId: string,
  options: { readonly baseUrl?: string; readonly key?: string } = {},
) => {
  const key = options.key ?? MERCHANT_KEY;
  await api.db.gatewayConfig.create({
    data: {
      schoolId,
      baseUrl: options.baseUrl ?? 'http://127.0.0.1:1',
      keyCiphertext: seal(key, api.deps.env.GATEWAY_ENCRYPTION_KEY),
      keyLast4: key.slice(-4),
      updatedAt: api.clock.now(),
    },
  });
};

/** A cohort that starts after the test clock, connected to the payment system. */
export const sellingCohort = async (
  api: TestApi,
  options: {
    readonly capacity?: number;
    readonly priceMinor?: number;
    readonly gatewayUrl?: string;
    readonly key?: string;
  } = {},
) => {
  const created = await createCohort(api.db, options);
  await connectGateway(api, created.school.id, {
    ...(options.gatewayUrl ? { baseUrl: options.gatewayUrl } : {}),
    ...(options.key ? { key: options.key } : {}),
  });
  return created;
};

/** Another cohort of the same course. */
export const siblingCohort = async (
  api: TestApi,
  base: Awaited<ReturnType<typeof createCohort>>,
  options: {
    readonly capacity?: number;
    readonly priceMinor?: number;
    readonly currency?: string;
    readonly startsAt?: Date;
  } = {},
) => {
  const startsAt = options.startsAt ?? new Date('2026-05-05T16:00:00Z');
  const cohort = await api.db.cohort.create({
    data: {
      courseId: base.course.id,
      schoolId: base.school.id,
      mentorId: base.mentor.id,
      startDate: new Date(startsAt.toISOString().slice(0, 10)),
      startsAt,
      timeZone: 'Europe/Kyiv',
      priceMinor: options.priceMinor ?? base.cohort.priceMinor,
      currency: options.currency ?? base.cohort.currency,
    },
  });
  await api.db.seatJournal.create({
    data: {
      cohortId: cohort.id,
      seatsDelta: 0,
      capacityDelta: options.capacity ?? 5,
      reason: 'capacity',
      actorKind: 'system',
      at: api.clock.now(),
    },
  });
  return cohort;
};

export type Notice = Record<string, unknown>;

export const paymentNotice = (input: {
  readonly schoolId: string;
  readonly orderId: string;
  readonly amountMinor: number;
  readonly currency?: string;
  readonly paymentId?: string;
  readonly eventId?: string;
}): Notice => ({
  type: 'payment.succeeded',
  eventId: input.eventId ?? randomUUID(),
  paymentId: input.paymentId ?? randomUUID(),
  schoolId: input.schoolId,
  orderId: input.orderId,
  amountMinor: input.amountMinor,
  currency: input.currency ?? 'UAH',
  occurredAt: new Date().toISOString(),
});

/** Posts a notification the way the payment system does. */
export const notify = (
  url: string,
  notice: Notice,
  options: { readonly key?: string; readonly at?: Date; readonly signature?: string } = {},
): Promise<Reply> => {
  const raw = JSON.stringify(notice);
  const signature =
    options.signature ?? sign(options.key ?? MERCHANT_KEY, raw, options.at ?? new Date());
  return client(url).send('POST', '/api/payments/webhook', {
    raw,
    headers: { [SIGNATURE_HEADER]: signature },
  });
};

export const processAll = async (api: TestApi): Promise<string[]> => {
  const pending = await api.db.paymentNotification.findMany({ where: { processedAt: null } });
  const results = await Promise.all(
    pending.map((row) =>
      runUnit(api.db, unitInput(api), (unit) => processNotification(unit, row.id)),
    ),
  );
  return results.map((result) => result.value);
};

export const processOne = (api: TestApi, notificationId: string) =>
  runUnit(api.db, unitInput(api), (unit) => processNotification(unit, notificationId));

export const expire = (api: TestApi, enrollmentId: string) =>
  runUnit(api.db, unitInput(api), (unit) => expireEnrollment(unit, enrollmentId));

/** Delivers a signed payment and lets it be processed, as the worker would. */
export const pay = async (api: TestApi, schoolId: string, enrollmentId: string) => {
  const enrollment = await api.db.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
  const reply = await notify(
    api.url,
    paymentNotice({
      schoolId,
      orderId: enrollmentId,
      amountMinor: enrollment.priceMinor,
      currency: enrollment.currency,
    }),
  );
  if (reply.status !== 200) throw new Error(`notification refused: ${reply.text}`);
  return processAll(api);
};

export const deliver = (api: TestApi, refundRequestId: string) =>
  deliverRefund(
    {
      db: api.db,
      now: () => Promise.resolve(api.clock.now()),
      timings: timings(api),
      encryptionKey: api.deps.env.GATEWAY_ENCRYPTION_KEY,
      timeoutMs: 1_500,
      callbackUrl: api.deps.env.WEBHOOK_CALLBACK_URL,
    },
    refundRequestId,
  );

export const paymentStub = async (
  api: TestApi,
  env: Readonly<Record<string, string>> = {},
  random?: () => number,
): Promise<Stub> =>
  startStub(
    loadStubEnv({
      PAYSTUB_PORT: '0',
      PAYSTUB_DATABASE_URL: api.databaseUrl,
      PAYSTUB_MERCHANT_KEY: MERCHANT_KEY,
      PAYSTUB_PUBLIC_URL: 'http://pay.example.test',
      PAYSTUB_RETRY_BASE_MS: '100',
      TEST_CONTROL_TOKEN: 'stub-control-token-0001',
      ...env,
    }),
    random ? { random } : {},
  );
