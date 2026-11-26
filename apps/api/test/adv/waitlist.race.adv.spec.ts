import { assertInvariants } from '@school/db/invariants/assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOW, startApi, type TestApi } from '../attacker/app';
import { burst } from '../attacker/burst';
import { expectError } from '../attacker/expect';
import { expire, pay, sellingCohort } from '../attacker/money';
import { signInAs, students, type Student } from '../attacker/students';

let api: TestApi;
beforeAll(async () => {
  api = await startApi({ copies: 2 });
});
afterAll(async () => {
  await api.stop();
});

const DAY = 86_400_000;

type Held = { id: string };

/** A full cohort of three paid students and seven people waiting, in a known order. */
const fullWithQueue = async () => {
  api.clock.set(NOW);
  const { cohort, school } = await sellingCohort(api, { capacity: 3 });
  const people = await students(api, 10);
  const seated = people.slice(0, 3);
  const queue = people.slice(3);
  const enrollments: string[] = [];
  for (const person of seated) {
    const reply = await person.http.post('/api/enrollments', { cohortId: cohort.id });
    const { id } = reply.body as Held;
    await pay(api, school.id, id);
    enrollments.push(id);
  }
  for (const person of queue) {
    expect((await person.http.post(`/api/waitlist/${cohort.id}`)).status).toBe(201);
  }
  return { cohort, school, seated, queue, enrollments };
};

const offers = async (cohortId: string) =>
  api.db.enrollment.findMany({
    where: { cohortId, status: 'offered' },
    orderBy: { studentId: 'asc' },
  });

const ids = (people: readonly Student[]) => people.map((person) => person.id).sort();

const cancelAll = (seated: readonly Student[], enrollments: readonly string[]) =>
  burst(seated.length, async (i) => {
    const person = seated[i];
    if (!person) throw new Error('fixture');
    return person.http.post(`/api/enrollments/${enrollments[i] ?? ''}/cancel`);
  });

describe('waiting list', () => {
  it('offers three freed seats to exactly the first three, then passes an unpaid one on once', async () => {
    for (let round = 0; round < 5; round += 1) {
      const { cohort, school, seated, queue, enrollments } = await fullWithQueue();
      const replies = await cancelAll(seated, enrollments);
      expect(replies.map((r) => r.status)).toEqual([200, 200, 200]);

      const first = await offers(cohort.id);
      expect(first.map((o) => o.studentId)).toEqual(ids(queue.slice(0, 3)));
      expect(first.map((o) => o.holdExpiresAt?.getTime())).toEqual(
        Array(3).fill(NOW.getTime() + DAY),
      );
      for (const offer of first) {
        expect(await api.db.emailOutbox.count({ where: { dedupeKey: `offer:${offer.id}` } })).toBe(
          1,
        );
      }

      // Two pay in time; the third lets 24 hours pass.
      const [slow, ...rest] = queue
        .slice(0, 3)
        .map((person) => first.find((o) => o.studentId === person.id));
      const unpaid = round % 2 === 0 ? slow : rest[0];
      for (const offer of first) if (offer.id !== unpaid?.id) await pay(api, school.id, offer.id);

      api.clock.set(new Date(NOW.getTime() + DAY - 1_000));
      await expire(api, unpaid?.id ?? '');
      expect(await offers(cohort.id)).toHaveLength(1);

      api.clock.set(new Date(NOW.getTime() + DAY));
      await burst(10, () => expire(api, unpaid?.id ?? ''));
      const next = await offers(cohort.id);
      expect(next.map((o) => o.studentId)).toEqual([queue[3]?.id]);
      const total = await api.db.enrollment.count({
        where: { cohortId: cohort.id, studentId: { in: ids(queue) } },
      });
      expect(total).toBe(4);
    }
    await assertInvariants(api.db);
  });

  it('cannot be jumped by rejoining, extra tabs or booking directly', async () => {
    const { cohort, queue, seated, enrollments } = await fullWithQueue();
    const last = queue.at(-1);
    if (!last) throw new Error('fixture');
    await burst(10, () => last.http.post(`/api/waitlist/${cohort.id}`));
    const place = (await last.http.get('/api/waitlist')).body as { items: { place: number }[] };
    expect(place.items[0]?.place).toBe(7);

    // While seats free up, outsiders and late waiters race for them directly.
    const outsiders = await students(api, 6);
    const [, direct] = await Promise.all([
      cancelAll(seated, enrollments),
      burst(12, (i) => {
        const person = [...outsiders, ...queue.slice(1)][i];
        if (!person) throw new Error('fixture');
        return person.http.post('/api/enrollments', { cohortId: cohort.id });
      }),
    ]);
    const offered = await offers(cohort.id);
    expect(offered.map((o) => o.studentId)).toEqual(ids(queue.slice(0, 3)));
    for (const reply of direct) {
      const allowed =
        reply.status === 409 ||
        // A person who already holds the offer gets it back.
        offered.some((o) => o.id === (reply.body as Held).id);
      expect(allowed).toBe(true);
    }
    await assertInvariants(api.db);
  });

  it('passes a declined offer to the next person immediately', async () => {
    const { cohort, queue, seated, enrollments } = await fullWithQueue();
    await seated[0]?.http.post(`/api/enrollments/${enrollments[0] ?? ''}/cancel`);
    const reply = await queue[0]?.http.send('DELETE', `/api/waitlist/${cohort.id}`);
    expect(reply?.status).toBe(200);
    expect((await offers(cohort.id)).map((o) => o.studentId)).toEqual([queue[1]?.id]);
    await assertInvariants(api.db);
  });

  it('serves new seats from a capacity increase to the queue first', async () => {
    const { cohort, queue, school } = await fullWithQueue();
    const manager = await api.db.user.create({
      data: {
        email: `m-${cohort.id}@example.test`,
        fullName: 'M',
        passwordHash: 'x',
        role: 'manager',
        schoolId: school.id,
      },
    });
    const http = await signInAs(api, manager.id);
    expect(
      (await http.patch(`/api/manager/cohorts/${cohort.id}/capacity`, { capacity: 5 })).status,
    ).toBe(204);
    expect((await offers(cohort.id)).map((o) => o.studentId)).toEqual(ids(queue.slice(0, 2)));
    expectError(
      await http.patch(`/api/manager/cohorts/${cohort.id}/capacity`, { capacity: 4 }),
      'CAPACITY_BELOW_TAKEN',
    );
    await assertInvariants(api.db);
  });

  it('refuses to queue while seats are open, or when already enrolled', async () => {
    api.clock.set(NOW);
    const { cohort, school } = await sellingCohort(api, { capacity: 1 });
    const [a, b] = await students(api, 2);
    if (!a || !b) throw new Error('fixture');
    expectError(await a.http.post(`/api/waitlist/${cohort.id}`), 'SEATS_AVAILABLE');
    const held = await a.http.post('/api/enrollments', { cohortId: cohort.id });
    await pay(api, school.id, (held.body as Held).id);
    expectError(await a.http.post(`/api/waitlist/${cohort.id}`), 'ALREADY_ENROLLED');
    api.clock.set(cohort.startsAt);
    expectError(await b.http.post(`/api/waitlist/${cohort.id}`), 'ENROLLMENT_CLOSED');
  });
});
