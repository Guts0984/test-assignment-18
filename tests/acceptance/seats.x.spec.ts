import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { burst } from '../../apps/api/test/attacker/burst';
import { client } from '../../apps/api/test/attacker/client';
import { expectError } from '../../apps/api/test/attacker/expect';
import { socket } from '../../apps/api/test/attacker/socket';
import * as stack from '../support/stack';

const HOUR = 3_600_000;

beforeAll(stack.resetClock);
afterAll(async () => {
  await stack.resetClock();
  await stack.disconnect();
});

const offersOf = (cohortId: string) =>
  stack.db().enrollment.findMany({ where: { cohortId, status: 'offered' } });

describe('acceptance: seats', () => {
  it('A-3 200 simultaneous bookings for 5 seats through both api copies give exactly 5', async () => {
    const owner = await stack.school();
    const cohort = await stack.cohort(owner, { capacity: 5 });
    const crowd = await stack.people(200);
    const replies = await burst(200, (i) => {
      const who = crowd[i];
      if (!who) throw new Error('fixture');
      return who.http.post('/api/enrollments', { cohortId: cohort.id });
    });
    expect(replies.filter((reply) => reply.status === 201)).toHaveLength(5);
    for (const reply of replies.filter((r) => r.status !== 201)) expectError(reply, 'NO_SEATS');
    expect(new Set(replies.map((reply) => reply.headers['x-instance']))).toEqual(
      new Set(['api-1', 'api-2']),
    );
    const journal = await stack.db().seatJournal.aggregate({
      where: { cohortId: cohort.id },
      _sum: { seatsDelta: true },
    });
    const stored = await stack.db().cohort.findUniqueOrThrow({ where: { id: cohort.id } });
    expect([stored.seatsTaken, journal._sum.seatsDelta]).toEqual([5, 5]);
  });

  it('A-5 three freed seats go to the first three, and an unpaid offer passes to the fourth', async () => {
    const owner = await stack.school();
    const cohort = await stack.cohort(owner, { capacity: 3, startsInDays: 20 });
    const crowd = await stack.people(8);
    const seated = crowd.slice(0, 3);
    const queue = crowd.slice(3);
    const enrollments: string[] = [];
    for (const who of seated) {
      const id = await stack.book(who, cohort.id);
      await stack.payNow(who, id);
      enrollments.push(id);
    }
    for (const who of queue) {
      expect((await who.http.post(`/api/waitlist/${cohort.id}`)).status).toBe(201);
    }
    await burst(3, async (i) =>
      seated[i]?.http.post(`/api/enrollments/${enrollments[i] ?? ''}/cancel`),
    );
    const first = await offersOf(cohort.id);
    expect(first.map((o) => o.studentId).sort()).toEqual(
      queue
        .slice(0, 3)
        .map((q) => q.id)
        .sort(),
    );
    for (const who of queue.slice(0, 3)) {
      await stack.until(
        async () => (await stack.mailCount(who.email, 'A seat is free')) === 1,
        'the offer email',
      );
    }
    for (const who of queue.slice(0, 2)) {
      const offer = first.find((o) => o.studentId === who.id);
      await stack.payNow(who, offer?.id ?? '');
    }
    await stack.setClock(new Date((await stack.now()).getTime() + 24 * HOUR + 60_000));
    const next = await stack.until(async () => {
      const open = await offersOf(cohort.id);
      return open.length === 1 && open[0]?.studentId === queue[3]?.id ? open : undefined;
    }, 'the fourth to receive an offer');
    expect(next).toHaveLength(1);
    expect(
      await stack.db().enrollment.count({
        where: { cohortId: cohort.id, studentId: { in: queue.map((q) => q.id) } },
      }),
    ).toBe(4);
    await stack.resetClock();
  });

  it('A-7 a transfer racing for the last seat leaves the student in exactly one cohort', async () => {
    const owner = await stack.school();
    for (let round = 0; round < 8; round += 1) {
      const from = await stack.cohort(owner, { capacity: 2 });
      const to = await stack.cohort(owner, { capacity: 1, startsInDays: 14 });
      const [mover, rival] = await stack.people(2);
      if (!mover || !rival) throw new Error('fixture');
      const id = await stack.book(mover, from.id);
      await stack.payNow(mover, id);
      await burst(2, (i) =>
        i === round % 2
          ? mover.http.post(`/api/enrollments/${id}/transfer`, { targetCohortId: to.id })
          : rival.http.post('/api/enrollments', { cohortId: to.id }),
      );
      const places = await stack.db().enrollment.findMany({
        where: { studentId: mover.id, status: 'paid' },
      });
      expect(places).toHaveLength(1);
      const target = await stack.db().cohort.findUniqueOrThrow({ where: { id: to.id } });
      const source = await stack.db().cohort.findUniqueOrThrow({ where: { id: from.id } });
      expect(target.seatsTaken).toBe(1);
      expect(source.seatsTaken).toBe(places[0]?.cohortId === to.id ? 0 : 1);
    }
  });

  it('A-14 a booking through copy B updates the manager and the catalog on copy A within a second', async () => {
    const owner = await stack.school();
    const cohort = await stack.cohort(owner, { capacity: 4 });
    const manager = await stack.again(owner.manager, stack.URLS.api[0]);
    const staff = await socket(stack.URLS.api[0], { as: manager });
    const visitor = await socket(stack.URLS.public);
    expect(await staff.join({ kind: 'cohort-staff', id: cohort.id })).toBe(true);
    expect(await visitor.join({ kind: 'catalog' })).toBe(true);
    const [buyer] = await stack.people(1);
    if (!buyer) throw new Error('fixture');
    const throughB = await stack.again(buyer, stack.URLS.api[1]);
    const started = Date.now();
    const reply = await throughB.post('/api/enrollments', { cohortId: cohort.id });
    expect(reply.headers['x-instance']).toBe('api-2');
    const seen = (events: typeof staff.received, event: string) =>
      events.some((e) => e.event === event && JSON.stringify(e.payload).includes(cohort.id));
    await stack.until(
      () =>
        Promise.resolve(
          seen(staff.received, 'roster.changed') && seen(visitor.received, 'seats.changed'),
        ),
      'the live updates',
      1_000,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    const roster = await manager.get(`/api/manager/cohorts/${cohort.id}/students`);
    expect(roster.body).toMatchObject({ total: 1 });
    const catalog = await client(stack.URLS.public).get(`/api/catalog/courses/${owner.course.id}`);
    expect(catalog.text).toContain('"freeSeats":3');
    staff.close();
    visitor.close();
  });

  it('A-15 other people’s data is refused over HTTP and over the socket', async () => {
    const owner = await stack.school();
    const foreign = await stack.school();
    const cohort = await stack.cohort(owner);
    const [victim, thief] = await stack.people(2);
    if (!victim || !thief) throw new Error('fixture');
    const id = await stack.book(victim, cohort.id);
    await stack.payNow(victim, id);
    const homework = await stack.db().homework.findFirstOrThrow({
      where: { cohortId: cohort.id },
    });
    const submission = await stack.db().submission.create({
      data: {
        homeworkId: homework.id,
        enrollmentId: id,
        studentId: victim.id,
        cohortId: cohort.id,
        status: 'submitted',
        body: 'private',
        submittedAt: await stack.now(),
        isLate: false,
      },
    });
    expectError(await thief.http.get(`/api/enrollments/${id}`), 'NOT_FOUND');
    expectError(await thief.http.post(`/api/enrollments/${id}/cancel`), 'NOT_FOUND');
    expectError(
      await foreign.mentor.http.get(`/api/mentor/submissions/${submission.id}`),
      'NOT_FOUND',
    );
    expectError(
      await foreign.manager.http.get(`/api/manager/cohorts/${cohort.id}/students`),
      'NOT_FOUND',
    );
    for (const guess of [id.replaceAll('-', '').padEnd(43, 'A'), 'A'.repeat(43)]) {
      expectError(await client(stack.URLS.public).get(`/api/verify/${guess}`), 'NOT_FOUND');
    }
    const rooms = [
      { kind: 'user', id: victim.id },
      { kind: 'mentor', id: owner.mentor.id },
      { kind: 'cohort-staff', id: cohort.id },
    ];
    for (const as of [undefined, thief.http, foreign.manager.http, foreign.mentor.http]) {
      const listener = await socket(stack.URLS.public, as ? { as } : {});
      for (const room of rooms) expect(await listener.join(room)).toBe(false);
      listener.close();
    }
  });
});
