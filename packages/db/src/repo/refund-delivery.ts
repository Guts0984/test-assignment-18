import { requestRefund, type GatewayFailure } from '@school/gateway/client';
import { open } from '@school/gateway/secret-box';
import { type Currency } from '@school/shared/money/money';
import { err, ok, type Result } from '@school/shared/result/result';
import { type Db } from '../client';
import { type Timings } from './context';
import { completeRefund } from './payment';
import { runUnit } from './unit-of-work';

export type RefundDeliveryDeps = {
  readonly db: Db;
  readonly now: () => Promise<Date>;
  readonly timings: Timings;
  readonly encryptionKey: string;
  readonly timeoutMs: number;
  readonly callbackUrl: string;
};

export type DeliveryFailure = GatewayFailure | { readonly kind: 'not_configured' };

/**
 * Asks the payment system to return money and books the result. Safe to repeat after any
 * failure: the request id is the idempotency key, and the refund is booked once, whether this
 * response or the notification gets there first.
 */
export const deliverRefund = async (
  deps: RefundDeliveryDeps,
  refundRequestId: string,
): Promise<Result<Awaited<ReturnType<typeof runUnit<string>>> | null, DeliveryFailure>> => {
  const request = await deps.db.refundRequest.findUnique({
    where: { id: refundRequestId },
    include: { enrollment: { include: { cohort: true } } },
  });
  if (!request || request.status !== 'pending') return ok(null);
  const { schoolId } = request.enrollment.cohort;
  const config = await deps.db.gatewayConfig.findUnique({ where: { schoolId } });
  if (!config) return err({ kind: 'not_configured' });
  const response = await requestRefund(
    {
      baseUrl: config.baseUrl,
      key: open(config.keyCiphertext, deps.encryptionKey),
      timeoutMs: deps.timeoutMs,
    },
    {
      refundId: request.id,
      schoolId,
      orderId: request.enrollmentId,
      amountMinor: Number(request.amountMinor),
      currency: request.currency as Currency,
      callbackUrl: deps.callbackUrl,
    },
  );
  if (!response.ok) return response;
  return ok(
    await runUnit(deps.db, { now: await deps.now(), timings: deps.timings }, (unit) =>
      completeRefund(unit, { refundRequestId: request.id }),
    ),
  );
};
