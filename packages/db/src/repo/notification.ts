import { notificationSchema, type Notification } from '@school/shared/schemas/gateway-protocol';
import { type Unit } from './context';
import { completeRefund, recordPayment } from './payment';

const apply = (unit: Unit, schoolId: string, event: Notification): Promise<string> => {
  if (event.type === 'payment.succeeded') {
    return recordPayment(unit, {
      schoolId,
      enrollmentId: event.orderId,
      providerPaymentId: `${schoolId}:${event.paymentId}`,
      amountMinor: event.amountMinor,
      currency: event.currency,
    });
  }
  if (event.type === 'refund.succeeded') {
    return completeRefund(unit, { schoolId, refundRequestId: event.refundId });
  }
  return Promise.resolve('payment_declined');
};

/** Acts on a stored notification exactly once, whoever calls and however often. */
export const processNotification = async (unit: Unit, notificationId: string): Promise<string> => {
  await unit.tx.$queryRaw`
    SELECT id FROM payment_notifications WHERE id = ${notificationId}::uuid FOR UPDATE`;
  const stored = await unit.tx.paymentNotification.findUnique({ where: { id: notificationId } });
  if (!stored) return 'missing';
  if (stored.processedAt) return stored.outcome ?? 'processed';
  const outcome = await apply(unit, stored.schoolId, notificationSchema.parse(stored.payload));
  await unit.tx.paymentNotification.update({
    where: { id: stored.id },
    data: { processedAt: unit.now, outcome },
  });
  return outcome;
};
