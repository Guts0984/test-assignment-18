import { addDays } from '@school/shared/schedule/zoned';
import { toZonedParts } from '@school/shared/schedule/display';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { burst } from '../../apps/api/test/attacker/burst';
import * as stack from '../support/stack';

const HOUR = 3_600_000;
/**
 * A past daylight saving week. Moving the business clock back makes nothing in the seeded data
 * due, so these checks see only their own work.
 */
const DST_SUNDAY = '2025-03-30';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(stack.resetClock);
afterAll(async () => {
  await stack.workers.start(1);
  await stack.resetClock();
  await stack.disconnect();
});

describe('acceptance: background work', () => {
  it('A-10 a lesson in the daylight saving week stays at 19:00 Kyiv; a late move sends each reminder once', async () => {
    await stack.setClock(new Date(`${addDays(DST_SUNDAY, -10)}T09:00:00Z`));
    const owner = await stack.school();
    const cohort = await stack.cohort(owner, {
      startDate: addDays(DST_SUNDAY, 2),
      weekdays: [2, 4],
      lessons: 2,
    });
    const [who] = await stack.people(1);
    if (!who) throw new Error('fixture');
    await stack.payNow(who, await stack.book(who, cohort.id));
    const lesson = await stack.db().lesson.findFirstOrThrow({
      where: { cohortId: cohort.id },
      orderBy: { startsAt: 'asc' },
    });
    expect(toZonedParts(lesson.startsAt, 'Europe/Kyiv')).toMatchObject({
      time: '19:00',
      offset: '+03:00',
    });
    const start = lesson.startsAt.getTime();
    await stack.setClock(new Date(start - 24 * HOUR));
    await stack.until(
      async () => (await stack.mailCount(who.email, 'Lesson in 24 hours')) === 1,
      'the day-ahead reminder',
    );
    // Thirty minutes before the hour reminder, the lesson moves two hours later.
    await stack.setClock(new Date(start - 1.5 * HOUR));
    const moved = await owner.manager.http.patch(`/api/manager/lessons/${lesson.id}`, {
      localDate: toZonedParts(lesson.startsAt, 'Europe/Kyiv').date,
      localTime: '21:00',
    });
    expect(moved.status).toBe(200);
    await stack.setClock(new Date(start - HOUR + 60_000));
    await pause(4_000);
    expect(await stack.mailCount(who.email, 'Lesson in 1 hour')).toBe(0);
    await stack.setClock(new Date(start + HOUR));
    await stack.until(
      async () => (await stack.mailCount(who.email, 'Lesson in 1 hour')) === 1,
      'the hour reminder at the new time',
    );
    await stack.setClock(new Date(start + 1.9 * HOUR));
    await pause(4_000);
    expect(await stack.mailCount(who.email, 'Lesson in 1 hour')).toBe(1);
    expect(await stack.mailCount(who.email, 'Lesson in 24 hours')).toBe(1);
    await stack.resetClock();
  });

  it('A-11 workers stopped, clock at the end, two workers started: one certificate each, numbered in a row', async () => {
    await stack.setClock(new Date('2025-01-06T09:00:00Z'));
    const owner = await stack.school();
    const enrolled: string[] = [];
    let end = 0;
    for (let c = 0; c < 2; c += 1) {
      const cohort = await stack.cohort(owner, { capacity: 20, startsInDays: 3, lessons: 3 });
      end = Math.max(end, cohort.endsAt?.getTime() ?? 0);
      const homework = await stack.db().homework.findMany({ where: { cohortId: cohort.id } });
      for (const who of await stack.people(15)) {
        const id = await stack.book(who, cohort.id);
        await stack.notify(await stack.notice(id));
        await stack.awaitStatus(id, 'paid');
        await stack.db().submission.createMany({
          data: homework.map((h) => ({
            homeworkId: h.id,
            enrollmentId: id,
            studentId: who.id,
            cohortId: cohort.id,
            status: 'accepted',
            body: 'done',
            submittedAt: new Date('2025-01-10'),
            isLate: false,
          })),
        });
        enrolled.push(id);
      }
    }
    await stack.workers.stop();
    await stack.setClock(new Date(end + 60_000));
    await stack.workers.start(2);
    const issued = () =>
      stack.db().certificate.findMany({
        where: { courseId: owner.course.id },
        orderBy: { number: 'asc' },
      });
    await stack.until(async () => (await issued()).length === 30, 'all certificates', 150_000);
    expect(await stack.workers.running()).toBe(2);
    await pause(3_000);
    const rows = await issued();
    expect(rows.map((r) => r.number)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(rows.map((r) => r.enrollmentId).sort()).toEqual(enrolled.sort());
    await stack.workers.start(1);
    await stack.resetClock();
  });

  it('A-12 kill -9 during expiry and FLUSHALL during bookings: all finished, nothing twice', async () => {
    await stack.setClock(new Date('2025-02-03T09:00:00Z'));
    const owner = await stack.school();
    const cohorts: string[] = [];
    const held: string[] = [];
    for (let c = 0; c < 20; c += 1) {
      const cohort = await stack.cohort(owner, { capacity: 4, startsInDays: 30 });
      cohorts.push(cohort.id);
      const group = await stack.people(4);
      held.push(
        ...(await burst(4, (i) => {
          const who = group[i];
          if (!who) throw new Error('fixture');
          return stack.book(who, cohort.id);
        })),
      );
    }
    await stack.setClock(new Date('2025-02-03T09:16:00Z'));
    const left = () => stack.db().enrollment.count({ where: { id: { in: held }, status: 'held' } });
    await stack.until(async () => (await left()) < held.length, 'expiry to begin');
    await stack.workers.kill();
    // Bookings go on while Redis is wiped.
    const fresh = await stack.cohort(owner, { capacity: 10, startsInDays: 30 });
    const crowd = await stack.people(10);
    const [bookings] = await Promise.all([
      burst(10, async (i) => {
        const who = crowd[i];
        if (!who) throw new Error('fixture');
        return who.http.post('/api/enrollments', { cohortId: fresh.id });
      }),
      stack.flushAll(),
    ]);
    await stack.flushAll();
    expect(bookings.every((reply) => reply.status === 201)).toBe(true);
    await stack.workers.start(1);
    await stack.until(async () => (await left()) === 0, 'every hold to expire', 150_000);
    await stack.setClock(new Date('2025-02-03T09:40:00Z'));
    await stack.until(
      async () =>
        (await stack.db().enrollment.count({ where: { cohortId: fresh.id, status: 'held' } })) ===
        0,
      'holds booked during the flush to expire',
      150_000,
    );
    expect(
      await stack.db().seatJournal.count({
        where: { cohortId: { in: [...cohorts, fresh.id] }, reason: 'expiry' },
      }),
    ).toBe(90);
    expect(await stack.violations()).toEqual([]);
    await stack.resetClock();
  });
});
