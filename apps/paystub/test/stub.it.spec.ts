import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createTestDatabase, type TestDatabase } from '@school/db/testing/database';
import { sign, SIGNATURE_HEADER, verify } from '@school/gateway/signature';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { startStub, type Stub } from '../src/server';

const KEY = 'merchant-key-used-by-tests-0001';

type Delivery = { signature: string | undefined; body: string };

let database: TestDatabase;
let stub: Stub;
let school: Server;
let callback: string;
const received: Delivery[] = [];
/** Statuses the school's webhook answers with, one per delivery; then 200. */
const answers: number[] = [];

beforeAll(async () => {
  database = await createTestDatabase(process.env['DATABASE_URL'] ?? '');
  school = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const header = request.headers[SIGNATURE_HEADER];
      received.push({
        signature: typeof header === 'string' ? header : undefined,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      response.writeHead(answers.shift() ?? 200).end();
    });
  });
  await new Promise<void>((resolve) => school.listen(0, '127.0.0.1', resolve));
  const address = school.address();
  callback = `http://127.0.0.1:${typeof address === 'object' ? (address?.port ?? 0) : 0}/hook`;
  stub = await startStub(
    loadEnv({
      PAYSTUB_PORT: '0',
      PAYSTUB_DATABASE_URL: database.url.split('?')[0],
      PAYSTUB_MERCHANT_KEY: KEY,
      PAYSTUB_PUBLIC_URL: 'http://pay.example.test',
      PAYSTUB_RETRY_BASE_MS: '50',
    }),
  );
});
afterAll(async () => {
  await stub.stop();
  school.close();
  await database.drop();
});

const signedPost = (path: string, payload: object, key: string = KEY) => {
  const body = JSON.stringify(payload);
  return fetch(`${stub.url}${path}`, {
    method: 'POST',
    headers: { [SIGNATURE_HEADER]: sign(key, body, new Date()) },
    body,
  });
};

const order = () => ({
  schoolId: randomUUID(),
  orderId: randomUUID(),
  amountMinor: 12_345,
  currency: 'UAH' as const,
});

const openSession = async (input = order()) => {
  const reply = await signedPost('/sessions', {
    ...input,
    description: '<script>alert(1)</script>',
    returnUrl: 'http://school.example.test/back',
    callbackUrl: callback,
  });
  const session = (await reply.json()) as { sessionId: string; payUrl: string };
  return { ...input, ...session, status: reply.status };
};

const press = (sessionId: string, button: 'pay' | 'decline' | 'close') =>
  fetch(`${stub.url}/pay/${sessionId}/${button}`, { method: 'POST', redirect: 'manual' });

const eventsFor = (orderId: string) =>
  received
    .map((delivery) => ({
      ...delivery,
      event: JSON.parse(delivery.body) as Record<string, string>,
    }))
    .filter((delivery) => delivery.event['orderId'] === orderId);

const waitFor = async (condition: () => boolean) => {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

describe('payment page', () => {
  it('offers pay, decline and close, and escapes what the school sends', async () => {
    const session = await openSession();
    expect(session.payUrl).toBe(`http://pay.example.test/pay/${session.sessionId}`);
    const page = await (await fetch(`${stub.url}/pay/${session.sessionId}`)).text();
    for (const label of ['Pay', 'Decline', 'Close without paying', '123.45 UAH']) {
      expect(page).toContain(label);
    }
    expect(page).not.toContain('<script>');
    expect(page).toContain('&lt;script&gt;');
  });

  it('announces a payment once, signed, however often the button is pressed', async () => {
    const session = await openSession();
    const replies = await Promise.all(
      Array.from({ length: 8 }, () => press(session.sessionId, 'pay')),
    );
    expect(new Set(replies.map((r) => r.status))).toEqual(new Set([303]));
    await waitFor(() => eventsFor(session.orderId).length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const [delivery, ...more] = eventsFor(session.orderId);
    expect(more).toEqual([]);
    expect(delivery?.event).toMatchObject({ type: 'payment.succeeded', amountMinor: 12_345 });
    expect(
      verify({
        key: KEY,
        header: delivery?.signature,
        body: delivery?.body ?? '',
        now: new Date(),
        maxSkewSec: 60,
      }),
    ).toBe(true);
  });

  it('reports a decline, and says nothing when the page is closed', async () => {
    const declined = await openSession();
    expect((await press(declined.sessionId, 'decline')).status).toBe(303);
    await waitFor(() => eventsFor(declined.orderId).length === 1);
    expect(eventsFor(declined.orderId)[0]?.event['type']).toBe('payment.failed');
    const closed = await openSession();
    const reply = await press(closed.sessionId, 'close');
    expect(reply.headers.get('location')).toBe('http://school.example.test/back');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(eventsFor(closed.orderId)).toEqual([]);
  });

  it('repeats a notification until the school accepts it', async () => {
    answers.push(500, 503, 500);
    const session = await openSession();
    await press(session.sessionId, 'pay');
    await waitFor(() => eventsFor(session.orderId).length === 4);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const deliveries = eventsFor(session.orderId);
    expect(deliveries).toHaveLength(4);
    expect(new Set(deliveries.map((d) => d.event['eventId'])).size).toBe(1);
  });

  it('returns the same session for the same order and amount', async () => {
    const first = await openSession();
    const again = await openSession({ ...first });
    expect(again.sessionId).toBe(first.sessionId);
  });
});

describe('merchant requests', () => {
  it('need a valid signature', async () => {
    const refund = { ...order(), refundId: randomUUID(), callbackUrl: callback };
    for (const path of ['/refunds', '/sessions']) {
      expect((await signedPost(path, refund, 'a-wrong-key-of-length-32')).status).toBe(401);
      expect((await fetch(`${stub.url}${path}`, { method: 'POST', body: '{}' })).status).toBe(401);
    }
    expect((await signedPost('/refunds', { ...refund, amountMinor: -1 })).status).toBe(400);
  });

  it('perform a refund once per id and refuse the id with other content', async () => {
    const refund = { ...order(), refundId: randomUUID(), callbackUrl: callback };
    const replies = await Promise.all(
      Array.from({ length: 6 }, () => signedPost('/refunds', refund)),
    );
    expect(new Set(replies.map((r) => r.status))).toEqual(new Set([200]));
    expect((await signedPost('/refunds', { ...refund, amountMinor: 1 })).status).toBe(409);
    await waitFor(() => eventsFor(refund.orderId).length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(eventsFor(refund.orderId)).toHaveLength(1);
    const listed = (await (await fetch(`${stub.url}/api/transactions`)).json()) as {
      refunds: { order_id: string }[];
    };
    expect(listed.refunds.filter((r) => r.order_id === refund.orderId)).toHaveLength(1);
    expect(await (await fetch(`${stub.url}/`)).text()).toContain(refund.refundId);
  });

  it('hides the test controls unless a token is configured', async () => {
    const reply = await fetch(`${stub.url}/control`, {
      method: 'POST',
      headers: { 'x-test-token': '' },
      body: '{"failRefunds":true}',
    });
    expect(reply.status).toBe(404);
    expect(stub.context.failRefunds).toBe(false);
  });
});
