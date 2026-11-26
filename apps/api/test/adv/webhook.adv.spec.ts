import { assertInvariants } from '@school/db/invariants/assert';
import { sign } from '@school/gateway/signature';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from '../attacker/app';
import { burst } from '../attacker/burst';
import { client } from '../attacker/client';
import { expectError } from '../attacker/expect';
import {
  MERCHANT_KEY,
  notify,
  paymentNotice,
  processAll,
  processOne,
  sellingCohort,
} from '../attacker/money';
import { student } from '../attacker/students';

let api: TestApi;
beforeAll(async () => {
  api = await startApi({ copies: 2 });
});
afterAll(async () => {
  await api.stop();
});

const KEY_B = 'the-other-schools-own-merchant-key';

const unpaid = async (key = MERCHANT_KEY) => {
  const { cohort, school } = await sellingCohort(api, { key });
  const buyer = await student(api);
  const reply = await buyer.http.post('/api/enrollments', { cohortId: cohort.id });
  const { id } = reply.body as { id: string };
  const notice = paymentNotice({ schoolId: school.id, orderId: id, amountMinor: 10_000 });
  return { cohort, school, buyer, id, notice };
};

const stateOf = async (id: string) => {
  const row = await api.db.enrollment.findUniqueOrThrow({ where: { id } });
  return [row.status, Number(row.balanceMinor)];
};

describe('payment notifications', () => {
  it('reject forgery without storing anything', async () => {
    const { notice, id, school } = await unpaid();
    const raw = JSON.stringify(notice);
    const attacks = [
      notify(api.url, notice, { key: 'guessed-key-guessed-key' }),
      notify(api.url, notice, { signature: '' }),
      notify(api.url, notice, {
        signature: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
      }),
      notify(api.url, notice, { at: new Date(Date.now() - 3_600_000) }),
      notify(api.url, notice, { at: new Date(Date.now() + 3_600_000) }),
      // A genuine signature of a cheaper body, sent with another amount.
      notify(api.url, notice, {
        signature: sign(MERCHANT_KEY, raw.replace('10000', '1'), new Date()),
      }),
      notify(api.url, { ...notice, schoolId: '018f6f1e-7b1a-7c3e-9d6a-111111111111' }),
    ];
    for (const reply of await Promise.all(attacks)) expectError(reply, 'INVALID_SIGNATURE');
    expect(await api.db.paymentNotification.count({ where: { schoolId: school.id } })).toBe(0);
    expect(await stateOf(id)).toEqual(['held', 0]);
  });

  it('apply one event once when sent ten times to both copies', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { notice, id } = await unpaid();
      const replies = await burst(10, (i) => notify(api.copies[i % 2]?.url ?? api.url, notice));
      expect(new Set(replies.map((r) => r.status))).toEqual(new Set([200]));
      const rows = await api.db.paymentNotification.findMany({
        where: { providerEventId: notice['eventId'] as string },
      });
      expect(rows).toHaveLength(1);
      const rowId = rows[0]?.id ?? '';
      const results = await burst(10, () => processOne(api, rowId));
      expect(new Set(results.map((r) => r.value))).toEqual(new Set(['enrolled']));
      expect(await stateOf(id)).toEqual(['paid', 10_000]);
      expect(await api.db.moneyOperation.count({ where: { enrollmentId: id } })).toBe(1);
      expect(await api.db.emailOutbox.count({ where: { dedupeKey: `paid:${id}` } })).toBe(1);
    }
    await assertInvariants(api.db);
  });

  it('count one payment once even under different event ids', async () => {
    const { school, id } = await unpaid();
    const notices = Array.from({ length: 6 }, (_, i) =>
      paymentNotice({
        schoolId: school.id,
        orderId: id,
        amountMinor: 10_000,
        paymentId: 'one-payment',
        eventId: `${id}-${i}`,
      }),
    );
    await Promise.all(notices.map((notice) => notify(api.url, notice)));
    expect((await processAll(api)).sort()).toEqual([
      ...Array<string>(5).fill('already_recorded'),
      'enrolled',
    ]);
    expect(await stateOf(id)).toEqual(['paid', 10_000]);
    await assertInvariants(api.db);
  });

  it('ignore a replayed event id that carries new content', async () => {
    const { notice, id } = await unpaid();
    await notify(api.url, notice);
    await processAll(api);
    const reply = await notify(api.url, { ...notice, amountMinor: 999_999, paymentId: 'second' });
    expect(reply.status).toBe(200);
    expect(await processAll(api)).toEqual([]);
    expect(await stateOf(id)).toEqual(['paid', 10_000]);
  });

  it('send back a second payment and a wrong amount', async () => {
    const paid = await unpaid();
    await notify(api.url, paid.notice);
    await processAll(api);
    await notify(
      api.url,
      paymentNotice({ schoolId: paid.school.id, orderId: paid.id, amountMinor: 10_000 }),
    );
    expect(await processAll(api)).toEqual(['refunding_duplicate']);
    expect((await stateOf(paid.id))[0]).toBe('paid');

    const cheap = await unpaid();
    await notify(
      api.url,
      paymentNotice({ schoolId: cheap.school.id, orderId: cheap.id, amountMinor: 1 }),
    );
    expect(await processAll(api)).toEqual(['refunding_amount']);
    expect(await stateOf(cheap.id)).toEqual(['held', 1]);
    const refunds = await api.db.refundRequest.findMany({ where: { enrollmentId: cheap.id } });
    expect(refunds.map((r) => [r.reason, Number(r.amountMinor)])).toEqual([['amount_mismatch', 1]]);
    await assertInvariants(api.db);
  });

  it('cannot be used by one school against another school’s enrollment', async () => {
    const mine = await unpaid();
    const other = await unpaid(KEY_B);
    const crafted = paymentNotice({
      schoolId: other.school.id,
      orderId: mine.id,
      amountMinor: 10_000,
    });
    expect((await notify(api.url, crafted, { key: KEY_B })).status).toBe(200);
    expect(await processAll(api)).toEqual(['rejected_enrollment']);
    expect(await stateOf(mine.id)).toEqual(['held', 0]);
    // Signing for the victim's school with the attacker's key fails outright.
    expectError(await notify(api.url, mine.notice, { key: KEY_B }), 'INVALID_SIGNATURE');
  });

  it('give the gateway key no other power', async () => {
    const { school } = await unpaid();
    for (const headers of [
      { authorization: `Bearer ${MERCHANT_KEY}` },
      { cookie: `access_token=${MERCHANT_KEY}` },
      { 'x-signature': sign(MERCHANT_KEY, '', new Date()) },
    ]) {
      for (const path of ['/api/auth/me', '/api/admin/gateway', '/api/manager/cohorts']) {
        const reply = await client(api.url).get(path, {
          headers: headers as unknown as Record<string, string>,
        });
        expectError(reply, 'UNAUTHENTICATED');
      }
    }
    expect(await api.db.user.count({ where: { schoolId: school.id } })).toBe(1);
  });
});
