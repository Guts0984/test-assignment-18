import { createCohortWithSchedule } from '@school/db/repo/cohort-schedule';
import { recordPayment } from '@school/db/repo/payment';
import { journalCapacity, SYSTEM_ACTOR } from '@school/db/repo/seat-journal';
import { createUser } from '@school/db/testing/factories';
import { QUEUE_NAMES } from '@school/shared/jobs/registry';
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

const subjects = async (address: string, prefix: string) =>
  (await inbox(address)).filter((mail) => mail.Subject.startsWith(prefix)).length;

describe('queues', () => {
  it('offers a seat that appeared without the transaction that frees seats', async () => {
    const { cohort } = await rig.cohort(1);
    await rig.holds(cohort.id, 1);
    const waiter = await createUser(rig.db);
    await rig.db.waitlistEntry.create({
      data: { cohortId: cohort.id, studentId: waiter.id, status: 'waiting', joinedAt: rig.start },
    });
    // Capacity is raised behind the application's back: only the sweeper can notice.
    await rig.unit((u) =>
      journalCapacity(u.tx, {
        cohortId: cohort.id,
        capacityDelta: 1,
        actor: SYSTEM_ACTOR,
        at: u.now,
      }),
    );
    const worker = rig.startWorker();
    await until(
      async () =>
        (await rig.db.enrollment.count({
          where: { cohortId: cohort.id, studentId: waiter.id, status: 'offered' },
        })) === 1,
      'the offer',
    );
    await until(async () => (await subjects(waiter.email, 'A seat')) === 1, 'the e-mail');
    await rig.kill(worker);
  });

  it('reminds of a deadline only the students who have not handed in', async () => {
    const base = await rig.cohort(1);
    const cohortId = await rig.unit((u) =>
      createCohortWithSchedule(
        u.tx,
        {
          schoolId: base.school.id,
          courseId: base.course.id,
          mentorId: base.mentor.id,
          startDate: '2026-03-10',
          timeZone: 'Europe/Warsaw',
          capacity: 5,
          priceMinor: 100,
          currency: 'UAH',
          lessonMinutes: 60,
          schedule: { weekdays: [2], localTime: '18:00', count: 1 },
        },
        { actor: SYSTEM_ACTOR, now: u.now },
      ),
    );
    const ids = await rig.holds(cohortId, 2);
    for (const enrollmentId of ids) {
      await rig.unit((u) =>
        recordPayment(u, {
          enrollmentId,
          schoolId: base.school.id,
          providerPaymentId: `d-${enrollmentId}`,
          amountMinor: 100,
          currency: 'UAH',
        }),
      );
    }
    const [done, pending] = await rig.db.enrollment.findMany({
      where: { id: { in: ids } },
      include: { student: true },
      orderBy: { id: 'asc' },
    });
    if (!done || !pending) throw new Error('fixture');
    const homework = await rig.db.homework.findFirstOrThrow({ where: { cohortId } });
    await rig.db.submission.create({
      data: {
        homeworkId: homework.id,
        enrollmentId: done.id,
        studentId: done.studentId,
        cohortId,
        status: 'submitted',
        body: 'in',
        submittedAt: rig.start,
        isLate: false,
      },
    });
    await rig.setTime(new Date(homework.deadlineAt.getTime() - 24 * HOUR));
    const worker = rig.startWorker();
    await until(
      async () => (await subjects(pending.student.email, 'Homework due')) === 1,
      'the deadline reminder',
    );
    await pause(1_500);
    expect(await subjects(done.student.email, 'Homework due')).toBe(0);
    expect(await subjects(pending.student.email, 'Homework due')).toBe(1);
    await rig.kill(worker);
  });

  it('is consumed under every name in the registry', async () => {
    const worker = rig.startWorker();
    await until(async () => {
      const counts = await Promise.all(
        QUEUE_NAMES.map(async (name) => (await rig.jobs.queue(name).getWorkers()).length),
      );
      return counts.every((count) => count > 0);
    }, 'a consumer for every queue');
    await rig.kill(worker);
  });
});
