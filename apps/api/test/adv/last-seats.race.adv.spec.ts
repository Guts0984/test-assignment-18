import { assertInvariants } from '@school/db/invariants/assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type TestApi } from '../attacker/app';
import { burst } from '../attacker/burst';
import { expectError } from '../attacker/expect';
import { sellingCohort } from '../attacker/money';
import { students, type Student } from '../attacker/students';

let api: TestApi;
let crowd: Student[];

beforeAll(async () => {
  api = await startApi({ copies: 2 });
  crowd = await students(api, 200);
});
afterAll(async () => {
  await api.stop();
});

const rush = async (cohortId: string, people: readonly Student[]) =>
  burst(people.length, (i) => {
    const person = people[i];
    if (!person) throw new Error('fixture');
    return person.http.post('/api/enrollments', { cohortId });
  });

describe('last seats', () => {
  it('gives 200 simultaneous students exactly 5 holds across both copies', async () => {
    for (let round = 0; round < 3; round += 1) {
      const { cohort } = await sellingCohort(api, { capacity: 5 });
      const replies = await rush(cohort.id, crowd);
      const held = replies.filter((reply) => reply.status === 201);
      expect(held).toHaveLength(5);
      for (const reply of replies.filter((r) => r.status !== 201)) expectError(reply, 'NO_SEATS');
      // Both copies took part in the race, whichever of them the winners came through.
      expect(new Set(replies.map((r) => r.headers['x-instance'])).size).toBe(2);

      const stored = await api.db.cohort.findUniqueOrThrow({ where: { id: cohort.id } });
      expect(stored.seatsTaken).toBe(5);
      const journal = await api.db.seatJournal.aggregate({
        where: { cohortId: cohort.id },
        _sum: { seatsDelta: true },
      });
      expect(journal._sum.seatsDelta).toBe(5);

      const loser = crowd[replies.findIndex((reply) => reply.status === 409)];
      const queued = await loser?.http.post(`/api/waitlist/${cohort.id}`);
      expect(queued?.status).toBe(201);
    }
    await assertInvariants(api.db);
  });

  it('gives one seat to exactly one of 20, twenty times over', async () => {
    const people = crowd.slice(0, 20);
    for (let round = 0; round < 20; round += 1) {
      const { cohort } = await sellingCohort(api, { capacity: 1 });
      const replies = await rush(cohort.id, people);
      expect(replies.filter((reply) => reply.status === 201)).toHaveLength(1);
      expect(replies.filter((reply) => reply.status === 409)).toHaveLength(19);
    }
    await assertInvariants(api.db);
  });

  it('turns many tabs of one student into one hold', async () => {
    const { cohort } = await sellingCohort(api, { capacity: 5 });
    const [one] = crowd;
    if (!one) throw new Error('fixture');
    const replies = await burst(15, () =>
      one.http.post('/api/enrollments', { cohortId: cohort.id }),
    );
    expect(new Set(replies.map((r) => r.status))).toEqual(new Set([201]));
    expect(new Set(replies.map((r) => (r.body as { id: string }).id)).size).toBe(1);
    expect(await api.db.enrollment.count({ where: { cohortId: cohort.id } })).toBe(1);
    await assertInvariants(api.db);
  });
});
