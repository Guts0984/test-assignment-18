import { assertInvariants } from '@school/db/invariants/assert';
import { open } from '@school/gateway/secret-box';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from './attacker/app';
import { expectError } from './attacker/expect';
import { pay, sellingCohort } from './attacker/money';
import { signedIn } from './attacker/people';
import { students } from './attacker/students';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.stop();
});

describe('manager views', () => {
  it('shows students, the waiting list, money and a search by name or e-mail', async () => {
    const sale = await sellingCohort(api, { capacity: 1 });
    const manager = (await signedIn(api, 'manager', sale.school.id)).http;
    const [paid, waiting] = await students(api, 2);
    if (!paid || !waiting) throw new Error('fixture');
    const held = await paid.http.post('/api/enrollments', { cohortId: sale.cohort.id });
    const { id } = held.body as { id: string };
    await pay(api, sale.school.id, id);
    await waiting.http.post(`/api/waitlist/${sale.cohort.id}`);
    const user = await api.db.user.findUniqueOrThrow({ where: { id: paid.id } });

    const base = `/api/manager/cohorts/${sale.cohort.id}`;
    expect((await manager.get(`${base}/students`)).body).toMatchObject({
      total: 1,
      items: [{ enrollmentId: id, status: 'paid', paidMinor: 10_000 }],
    });
    expect(
      (await manager.get(`${base}/students?q=${user.email.slice(5, 20).toUpperCase()}`)).body,
    ).toMatchObject({ total: 1 });
    expect((await manager.get(`${base}/waitlist`)).body).toMatchObject({
      items: [{ studentId: waiting.id, status: 'waiting' }],
    });
    expect((await manager.get(`${base}/payments`)).body).toMatchObject({
      items: [{ kind: 'payment', amountMinor: 10_000 }],
    });
    const found = await manager.get(
      `/api/manager/students?q=${encodeURIComponent(user.email.slice(0, 18))}`,
    );
    expect(found.body).toMatchObject({
      total: 1,
      items: [{ studentId: paid.id, enrollments: [{ enrollmentId: id }] }],
    });

    expect(
      (await manager.post(`/api/manager/enrollments/${id}/exclude`, { refundPolicy: 'rule' }))
        .status,
    ).toBe(204);
    expect((await manager.get(`${base}/payments`)).body).toMatchObject({
      total: 2,
    });
    await assertInvariants(api.db);
  });

  it('creates promo codes once and keeps the limit above what is used', async () => {
    const sale = await sellingCohort(api);
    const manager = (await signedIn(api, 'manager', sale.school.id)).http;
    const body = {
      code: 'spring-26',
      discount: { kind: 'fixed', amountMinor: 500, currency: 'UAH' },
      validFrom: '2026-01-01T00:00:00Z',
      validUntil: '2027-01-01T00:00:00Z',
      maxUses: 2,
    };
    const created = await manager.post('/api/manager/promos', body);
    expect(created.body).toMatchObject({ code: 'SPRING-26', usedCount: 0, courseId: null });
    expectError(await manager.post('/api/manager/promos', body), 'CONFLICT');
    for (const bad of [
      { ...body, code: 'X2', validUntil: body.validFrom },
      { ...body, code: 'X3', maxUses: 0 },
      { ...body, code: 'X4', usedCount: 0 },
      { ...body, code: 'X5', discount: { kind: 'percent', percent: 150 } },
    ]) {
      expectError(await manager.post('/api/manager/promos', bad), 'VALIDATION_FAILED');
    }
    const [a, b] = await students(api, 2);
    for (const person of [a, b]) {
      await person?.http.post('/api/enrollments', {
        cohortId: sale.cohort.id,
        promoCode: 'SPRING-26',
      });
    }
    const url = `/api/manager/promos/${(created.body as { id: string }).id}`;
    expectError(await manager.patch(url, { maxUses: 1 }), 'CONFLICT');
    expect((await manager.patch(url, { maxUses: 3 })).body).toMatchObject({
      maxUses: 3,
      reservedCount: 2,
    });
  });
});

describe('payment system settings', () => {
  it('store the key encrypted and never return it', async () => {
    const sale = await sellingCohort(api);
    const admin = (await signedIn(api, 'admin', sale.school.id)).http;
    const key = 'brand-new-merchant-key-value';
    const reply = await admin.send('PUT', '/api/admin/gateway', {
      body: { baseUrl: 'http://paystub:4000', key },
    });
    expect(reply.body).toMatchObject({ configured: true, keyLast4: 'alue' });
    expect(reply.text).not.toContain(key);
    expect((await admin.get('/api/admin/gateway')).text).not.toContain(key);
    const stored = await api.db.gatewayConfig.findUniqueOrThrow({
      where: { schoolId: sale.school.id },
    });
    expect(stored.keyCiphertext).not.toContain(key);
    expect(open(stored.keyCiphertext, api.deps.env.GATEWAY_ENCRYPTION_KEY)).toBe(key);
    for (const baseUrl of ['file:///etc/passwd', 'ftp://x', 'not a url']) {
      expectError(
        await admin.send('PUT', '/api/admin/gateway', { body: { baseUrl, key } }),
        'VALIDATION_FAILED',
      );
    }
  });

  it('turns an unreachable payment system into a clear error', async () => {
    const sale = await sellingCohort(api);
    const [a] = await students(api, 1);
    const held = await a?.http.post('/api/enrollments', { cohortId: sale.cohort.id });
    const { id } = held?.body as { id: string };
    const reply = await a?.http.post(`/api/enrollments/${id}/checkout`);
    if (reply) expectError(reply, 'GATEWAY_UNAVAILABLE');
    await api.db.gatewayConfig.delete({ where: { schoolId: sale.school.id } });
    const without = await a?.http.post(`/api/enrollments/${id}/checkout`);
    if (without) expectError(without, 'GATEWAY_NOT_CONFIGURED');
  });
});
