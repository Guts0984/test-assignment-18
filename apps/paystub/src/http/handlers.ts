import { createHash, timingSafeEqual } from 'node:crypto';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { SIGNATURE_HEADER, verify } from '@school/gateway/signature';
import { createSessionSchema, refundRequestSchema } from '@school/shared/schemas/gateway-protocol';
import { type Pool } from 'pg';
import { z } from 'zod';
import { notifiesBeforeAnswering, planPaymentDelivery, refundFault, type Chaos } from '../chaos';
import { type StubEnv } from '../config/env';
import { enqueueDelivery, releaseDelayed } from '../delivery';
import * as store from '../store';
import { readBody, redirect, sendHtml, sendJson } from './io';
import { notFoundPage, paymentPage, transactionsPage } from './pages';

export type Context = {
  readonly env: StubEnv;
  readonly pool: Pool;
  /** Mutable only through the test control route. */
  chaos: Chaos;
  failRefunds: boolean;
  readonly random: () => number;
  /** Sends due notifications now instead of at the next tick. */
  readonly flush: () => Promise<unknown>;
};

type Exchange = {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly params: readonly string[];
};

export type Handler = (context: Context, exchange: Exchange) => Promise<void>;

const signedPayload = async <T>(
  context: Context,
  { request, response }: Exchange,
  schema: z.ZodType<T>,
): Promise<T | undefined> => {
  const body = await readBody(request);
  if (body === 'too_large') {
    sendJson(response, 413, { error: 'too large' });
    return undefined;
  }
  const header = request.headers[SIGNATURE_HEADER];
  const authentic = verify({
    key: context.env.PAYSTUB_MERCHANT_KEY,
    header: typeof header === 'string' ? header : undefined,
    body,
    now: new Date(),
    maxSkewSec: 300,
  });
  if (!authentic) {
    sendJson(response, 401, { error: 'bad signature' });
    return undefined;
  }
  try {
    return schema.parse(JSON.parse(body.toString('utf8')));
  } catch {
    sendJson(response, 400, { error: 'invalid request' });
    return undefined;
  }
};

export const createSession: Handler = async (context, exchange) => {
  const input = await signedPayload(context, exchange, createSessionSchema);
  if (!input) return;
  const sessionId = await store.upsertSession(context.pool, input);
  const base = context.env.PAYSTUB_PUBLIC_URL.replace(/\/$/, '');
  sendJson(exchange.response, 201, { sessionId, payUrl: `${base}/pay/${sessionId}` });
};

export const refund: Handler = async (context, exchange) => {
  const input = await signedPayload(context, exchange, refundRequestSchema);
  if (!input) return;
  const attempt = await store.countRefundCall(context.pool, input.refundId);
  const fault = context.failRefunds ? 'error' : refundFault(context.chaos, attempt);
  // A 500 means nothing happened; a timeout hides a refund that did happen.
  if (fault === 'error') {
    sendJson(exchange.response, 500, { error: 'temporary failure' });
    return;
  }
  const stored = await store.storeRefund(context.pool, input);
  if (stored === 'conflict') {
    sendJson(exchange.response, 409, { error: 'refund id reused with other content' });
    return;
  }
  const { callbackUrl, refundId, schoolId, orderId, amountMinor, currency } = input;
  if (stored === 'created') {
    await enqueueDelivery(
      context.pool,
      { type: 'refund.succeeded', refundId, schoolId, orderId, amountMinor, currency },
      [callbackUrl],
    );
  }
  if (fault === 'timeout') return;
  if (notifiesBeforeAnswering(context.chaos, context.random)) {
    await context.flush();
  }
  sendJson(exchange.response, 200, { refundId, status: 'succeeded' });
};

const withSession =
  (
    act: (context: Context, exchange: Exchange, session: store.SessionRow) => Promise<void>,
  ): Handler =>
  async (context, exchange) => {
    const id = z.uuid().safeParse(exchange.params[0]);
    const session = id.success ? await store.findSession(context.pool, id.data) : undefined;
    if (!session) {
      sendHtml(exchange.response, 404, notFoundPage());
      return;
    }
    await act(context, exchange, session);
  };

export const showPayment: Handler = withSession((_context, { response }, session) => {
  sendHtml(response, 200, paymentPage(session));
  return Promise.resolve();
});

const announce = (
  context: Context,
  session: store.SessionRow,
  type: 'payment.succeeded' | 'payment.failed',
  paymentId: string,
) => {
  const plan = planPaymentDelivery(context.chaos, session.callback_url, context.random);
  return enqueueDelivery(
    context.pool,
    {
      type,
      paymentId,
      schoolId: session.school_id,
      orderId: session.order_id,
      amountMinor: Number(session.amount_minor),
      currency: session.currency as 'UAH' | 'EUR' | 'USD',
    },
    plan.targets,
    plan.delaySec,
  );
};

export const pay: Handler = withSession(async (context, { response }, session) => {
  const paid = await store.markPaid(context.pool, session.id);
  if (paid?.payment_id) {
    await announce(context, paid, 'payment.succeeded', paid.payment_id);
    void context.flush();
  }
  redirect(response, session.return_url);
});

export const decline: Handler = withSession(async (context, { response }, session) => {
  if (session.status !== 'paid') {
    await store.markStatus(context.pool, session.id, 'declined');
    await announce(context, session, 'payment.failed', `declined-${session.id}`);
    void context.flush();
  }
  redirect(response, session.return_url);
});

export const close: Handler = withSession(async (context, { response }, session) => {
  await store.markStatus(context.pool, session.id, 'closed');
  redirect(response, session.return_url);
});

export const health: Handler = (_context, { response }) => {
  sendJson(response, 200, { status: 'ok' });
  return Promise.resolve();
};

export const overview: Handler = async (context, { response }) => {
  sendHtml(response, 200, transactionsPage(await store.listTransactions(context.pool)));
};

export const transactions: Handler = async (context, { response }) => {
  sendJson(response, 200, await store.listTransactions(context.pool));
};

const controlSchema = z.strictObject({
  chaos: z.boolean().optional(),
  lateProbability: z.number().min(0).max(1).optional(),
  earlyRefundProbability: z.number().min(0).max(1).optional(),
  failRefunds: z.boolean().optional(),
  releaseDelayed: z.boolean().optional(),
});

const tokenMatches = (presented: string, expected: string): boolean => {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return expected !== '' && timingSafeEqual(digest(presented), digest(expected));
};

/** Test control. Absent unless a token is configured. */
export const control: Handler = async (context, { request, response }) => {
  const token = request.headers['x-test-token'];
  if (!tokenMatches(typeof token === 'string' ? token : '', context.env.TEST_CONTROL_TOKEN)) {
    sendJson(response, 404, { error: 'not found' });
    return;
  }
  const body = await readBody(request);
  const parsed = controlSchema.safeParse(
    body === 'too_large' ? null : JSON.parse(body.toString('utf8') || '{}'),
  );
  if (!parsed.success) {
    sendJson(response, 400, { error: 'invalid request' });
    return;
  }
  const change = parsed.data;
  context.chaos = {
    ...context.chaos,
    enabled: change.chaos ?? context.chaos.enabled,
    lateProbability: change.lateProbability ?? context.chaos.lateProbability,
    earlyRefundProbability: change.earlyRefundProbability ?? context.chaos.earlyRefundProbability,
  };
  context.failRefunds = change.failRefunds ?? context.failRefunds;
  const released = change.releaseDelayed ? await releaseDelayed(context.pool) : 0;
  if (released > 0) await context.flush();
  sendJson(response, 200, { released });
};
