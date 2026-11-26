import { z } from 'zod';
import { amountMinorSchema, currencySchema } from '../money/money';
import { idSchema, instantSchema, text } from './common';

/** The wire contract between this system and the payment system. */

export const createSessionSchema = z.strictObject({
  schoolId: idSchema,
  orderId: idSchema,
  amountMinor: amountMinorSchema.min(1),
  currency: currencySchema,
  description: text(1, 200),
  returnUrl: z.url(),
  callbackUrl: z.url(),
});

export const sessionSchema = z.object({ sessionId: z.string().min(1), payUrl: z.url() });

export const refundRequestSchema = z.strictObject({
  refundId: idSchema,
  schoolId: idSchema,
  orderId: idSchema,
  amountMinor: amountMinorSchema.min(1),
  currency: currencySchema,
  callbackUrl: z.url(),
});

export const refundResultSchema = z.object({
  refundId: idSchema,
  status: z.literal('succeeded'),
});

const event = {
  eventId: z.string().min(1).max(100),
  schoolId: idSchema,
  orderId: idSchema,
  amountMinor: amountMinorSchema.min(1),
  currency: currencySchema,
  occurredAt: instantSchema,
};

export const notificationSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('payment.succeeded'),
    paymentId: z.string().min(1).max(100),
    ...event,
  }),
  z.strictObject({
    type: z.literal('payment.failed'),
    paymentId: z.string().min(1).max(100),
    ...event,
  }),
  z.strictObject({ type: z.literal('refund.succeeded'), refundId: idSchema, ...event }),
]);

export const notificationAckSchema = z.object({ received: z.literal(true) });

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type GatewayRefundInput = z.infer<typeof refundRequestSchema>;
export type Notification = z.infer<typeof notificationSchema>;
