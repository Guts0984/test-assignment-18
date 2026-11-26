import { createCohortWithSchedule, rescheduleLesson } from '@school/db/repo/cohort-schedule';
import { recordPayment } from '@school/db/repo/payment';
import { SYSTEM_ACTOR } from '@school/db/repo/seat-journal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inbox } from '../mail';
import { pause, startRig, until, type Rig } from '../rig';

let rig: Rig;
beforeAll(async () => {
  rig = await startRig();
});
afterAll(async () => {
  await rig.stop();
});

const HOUR = 3_600_000;

const count = async (address: string, subject: string) =>
  (await inbox(address)).filter((mail) => mail.Subject.startsWith(subject)).length;

describe('reminders', () => {
  it('arrive once each, on time in the daylight saving week, and follow a moved lesson', async () => {
    const base = await rig.cohort(1);
    // Tuesdays and Thursdays at 19:00 Kyiv; the clocks change on Sunday 29 March 2026.
    const cohortId = await rig.unit((u) =>
      createCohortWithSchedule(
        u.tx,
        {
          schoolId: base.school.id,
          courseId: base.course.id,
          mentorId: base.mentor.id,
          startDate: '2026-03-31',
          timeZone: 'Europe/Kyiv',
          capacity: 5,
          priceMinor: 10_000,
          currency: 'UAH',
          lessonMinutes: 90,
          schedule: { weekdays: [2, 4], localTime: '19:00', count: 2 },
        },
        { actor: SYSTEM_ACTOR, now: u.now },
      ),
    );
    const [enrollmentId] = await rig.holds(cohortId, 1);
    await rig.unit((u) =>
      recordPayment(u, {
        enrollmentId: enrollmentId ?? '',
        schoolId: base.school.id,
        providerPaymentId: 'reminder-payment',
        amountMinor: 10_000,
        currency: 'UAH',
      }),
    );
    const { student } = await rig.db.enrollment.findUniqueOrThrow({
      where: { id: enrollmentId ?? '' },
      include: { student: true },
    });
    const lessons = await rig.db.lesson.findMany({
      where: { cohortId },
      orderBy: { startsAt: 'asc' },
    });
    const first = lessons[0];
    if (!first) throw new Error('fixture');
    // 19:00 in Kyiv is 16:00 UTC after the change.
    expect(first.startsAt.toISOString()).toBe('2026-03-31T16:00:00.000Z');

    const workers = [rig.startWorker(), rig.startWorker()];
    const start = first.startsAt.getTime();
    await rig.setTime(new Date(start - 24 * HOUR - 5_000));
    await pause(1_500);
    expect(await count(student.email, 'Lesson in 24 hours')).toBe(0);

    await rig.setTime(new Date(start - 24 * HOUR));
    await until(
      async () => (await count(student.email, 'Lesson in 24 hours')) === 1,
      'the day-ahead reminder',
    );
    await rig.flushRedis();

    // Thirty minutes before the hour reminder is due, the lesson moves three hours later.
    await rig.setTime(new Date(start - 1.5 * HOUR));
    await rig.unit((u) =>
      rescheduleLesson(u.tx, {
        lessonId: first.id,
        schoolId: base.school.id,
        localDate: '2026-03-31',
        localTime: '22:00',
        now: u.now,
      }),
    );
    const moved = start + 3 * HOUR;
    // The old hour reminder's moment passes without a word.
    await rig.setTime(new Date(start - HOUR + 60_000));
    await pause(1_500);
    expect(await count(student.email, 'Lesson in 1 hour')).toBe(0);

    await rig.setTime(new Date(moved - HOUR - 5_000));
    await pause(1_000);
    expect(await count(student.email, 'Lesson in 1 hour')).toBe(0);
    await rig.setTime(new Date(moved - HOUR));
    await until(
      async () => (await count(student.email, 'Lesson in 1 hour')) === 1,
      'the hour reminder',
    );
    await rig.flushRedis();
    await rig.setTime(new Date(moved - 60_000));
    await pause(1_500);
    expect(await count(student.email, 'Lesson in 1 hour')).toBe(1);
    // The move happened inside the last 24 hours, so no second day-ahead reminder is owed.
    expect(await count(student.email, 'Lesson in 24 hours')).toBe(1);

    const rows = await rig.db.scheduledNotification.findMany({
      where: { lessonId: first.id, kind: 'lesson_1h' },
      orderBy: { lessonVersion: 'asc' },
    });
    expect(rows.map((row) => [row.lessonVersion, row.status])).toEqual([
      [1, 'cancelled'],
      [2, 'done'],
    ]);
    await Promise.all(workers.map(rig.kill));
  });
});
