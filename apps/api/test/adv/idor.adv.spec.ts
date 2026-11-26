import { assertInvariants } from '@school/db/invariants/assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from '../attacker/app';
import { client } from '../attacker/client';
import { expectError } from '../attacker/expect';
import { pay, sellingCohort, siblingCohort } from '../attacker/money';
import { signedIn } from '../attacker/people';
import { student, students } from '../attacker/students';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(async () => {
  await api.stop();
});

const victimSetup = async () => {
  const sale = await sellingCohort(api, { capacity: 5 });
  const victim = await student(api);
  const held = await victim.http.post('/api/enrollments', { cohortId: sale.cohort.id });
  const { id } = held.body as { id: string };
  await pay(api, sale.school.id, id);
  const next = await siblingCohort(api, sale);
  return { ...sale, victim, id, next };
};

describe('another student’s enrollment', () => {
  it('cannot be read, paid, discounted, moved or cancelled', async () => {
    const { id, next, victim } = await victimSetup();
    const thief = await student(api);
    const attempts = [
      thief.http.get(`/api/enrollments/${id}`),
      thief.http.get(`/api/enrollments/${id}/refund-preview`),
      thief.http.get(`/api/enrollments/${id}/transfer-options`),
      thief.http.post(`/api/enrollments/${id}/cancel`),
      thief.http.post(`/api/enrollments/${id}/checkout`),
      thief.http.post(`/api/enrollments/${id}/promo`, { code: 'ANY' }),
      thief.http.post(`/api/enrollments/${id}/transfer`, { targetCohortId: next.id }),
    ];
    for (const reply of await Promise.all(attempts)) expectError(reply, 'NOT_FOUND');
    expect((await thief.http.get('/api/enrollments')).body).toEqual({ items: [] });
    expect((await victim.http.get(`/api/enrollments/${id}`)).body).toMatchObject({
      status: 'paid',
    });
    expect(await api.db.refundRequest.count({ where: { enrollmentId: id } })).toBe(0);
  });

  it('cannot be created for someone else, or at a chosen price or status', async () => {
    const { cohort } = await sellingCohort(api);
    const [attacker, other] = await students(api, 2);
    if (!attacker || !other) throw new Error('fixture');
    for (const extra of [
      { studentId: other.id },
      { priceMinor: 1 },
      { status: 'paid' },
      { holdExpiresAt: '2030-01-01T00:00:00Z' },
    ]) {
      expectError(
        await attacker.http.post('/api/enrollments', { cohortId: cohort.id, ...extra }),
        'VALIDATION_FAILED',
      );
    }
    expect(await api.db.enrollment.count({ where: { cohortId: cohort.id } })).toBe(0);
  });
});

describe('another school’s cohort', () => {
  it('gives a foreign manager nothing and accepts no changes', async () => {
    const { id, cohort, next } = await victimSetup();
    const foreign = await sellingCohort(api);
    const intruder = (await signedIn(api, 'manager', foreign.school.id)).http;
    const attempts = [
      intruder.get(`/api/manager/cohorts/${cohort.id}/students`),
      intruder.get(`/api/manager/cohorts/${cohort.id}/waitlist`),
      intruder.get(`/api/manager/cohorts/${cohort.id}/payments`),
      intruder.patch(`/api/manager/cohorts/${cohort.id}/capacity`, { capacity: 100 }),
      intruder.post(`/api/manager/enrollments/${id}/exclude`, { refundPolicy: 'full' }),
      intruder.post(`/api/manager/enrollments/${id}/transfer`, { targetCohortId: next.id }),
    ];
    for (const reply of await Promise.all(attempts)) expectError(reply, 'NOT_FOUND');
    const search = await intruder.get('/api/manager/students?q=user');
    expect(search.body).toMatchObject({ total: 0 });
    expect((await api.db.cohort.findUniqueOrThrow({ where: { id: cohort.id } })).capacity).toBe(5);
    await assertInvariants(api.db);
  });

  it('cannot receive a student from the manager’s own school', async () => {
    const mine = await victimSetup();
    const foreign = await sellingCohort(api);
    const manager = (await signedIn(api, 'manager', mine.school.id)).http;
    expectError(
      await manager.post(`/api/manager/enrollments/${mine.id}/transfer`, {
        targetCohortId: foreign.cohort.id,
      }),
      'NOT_FOUND',
    );
  });

  it('cannot give its promo codes or gateway to outsiders', async () => {
    const theirs = await sellingCohort(api);
    const promo = await api.db.promoCode.create({
      data: {
        schoolId: theirs.school.id,
        code: 'SECRET',
        discountKind: 'percent',
        percent: 90,
        validFrom: new Date('2026-01-01'),
        validUntil: new Date('2027-01-01'),
        maxUses: 1,
      },
    });
    const mine = await sellingCohort(api);
    const manager = (await signedIn(api, 'manager', mine.school.id)).http;
    expectError(
      await manager.patch(`/api/manager/promos/${promo.id}`, { maxUses: 99 }),
      'NOT_FOUND',
    );
    expect((await manager.get('/api/manager/promos')).text).not.toContain('SECRET');
    expectError(
      await manager.post('/api/manager/promos', {
        code: 'SNEAK',
        courseId: theirs.course.id,
        discount: { kind: 'percent', percent: 10 },
        validFrom: '2026-01-01T00:00:00Z',
        validUntil: '2027-01-01T00:00:00Z',
        maxUses: 1,
      }),
      'NOT_FOUND',
    );
    const admin = (await signedIn(api, 'admin', mine.school.id)).http;
    expect((await admin.get('/api/admin/gateway')).body).toMatchObject({ configured: true });
    expect((await client(api.url).get('/api/admin/gateway')).status).toBe(401);
  });
});
