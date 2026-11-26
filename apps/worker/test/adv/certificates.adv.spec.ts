import { assertInvariants } from '@school/db/invariants/assert';
import { createEnrollment, createUser } from '@school/db/testing/factories';
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

const END = new Date('2026-04-01T18:30:00Z');

/** A cohort with five homework tasks; the first `eligible` students did four of them. */
const finishedCohort = async (courseId: string, eligible: number, short: number) => {
  const { cohort: base, school, mentor } = await rig.cohort(eligible + short);
  const cohort = await rig.db.cohort.update({
    where: { id: base.id },
    data: { courseId, endsAt: END },
  });
  const homework: string[] = [];
  for (let seq = 1; seq <= 5; seq += 1) {
    const lesson = await rig.db.lesson.create({
      data: {
        cohortId: cohort.id,
        seq,
        localDate: new Date('2026-03-03'),
        localTime: '19:00',
        startsAt: new Date(END.getTime() - (6 - seq) * 86_400_000),
        endsAt: new Date(END.getTime() - (6 - seq) * 86_400_000 + 5_400_000),
        homework: {
          create: { cohortId: cohort.id, title: `H${seq}`, deadlineAt: END },
        },
      },
      include: { homework: true },
    });
    homework.push(lesson.homework?.id ?? '');
  }
  await rig.db.lesson.updateMany({ where: { cohortId: cohort.id, seq: 5 }, data: { endsAt: END } });
  const passed: string[] = [];
  const failed: string[] = [];
  for (let i = 0; i < eligible + short; i += 1) {
    const student = await createUser(rig.db);
    const enrollment = await createEnrollment(rig.db, cohort, {
      status: 'paid',
      studentId: student.id,
    });
    // Four of five is exactly 80 %; three of five is not enough.
    await rig.db.submission.createMany({
      data: homework.slice(0, i < eligible ? 4 : 3).map((homeworkId) => ({
        homeworkId,
        enrollmentId: enrollment.id,
        studentId: student.id,
        cohortId: cohort.id,
        status: 'accepted',
        body: 'done',
        submittedAt: rig.start,
        isLate: false,
      })),
    });
    (i < eligible ? passed : failed).push(enrollment.id);
  }
  return { cohort, school, mentor, passed, failed };
};

describe('certificates', () => {
  it('are issued once each, numbered without gaps, through kill -9, a flush and two workers', async () => {
    const { course } = await rig.cohort(1);
    const cohorts = [
      await finishedCohort(course.id, 40, 3),
      await finishedCohort(course.id, 40, 3),
      await finishedCohort(course.id, 40, 3),
    ];
    const passed = cohorts.flatMap((c) => c.passed);
    const issued = () => rig.db.certificate.count({ where: { courseId: course.id } });

    // Workers are stopped; the clock moves past the end; two copies start.
    await rig.setTime(new Date(END.getTime() + 1_000));
    const a = rig.startWorker();
    const b = rig.startWorker();
    await until(async () => (await issued()) >= 10, 'the first certificates');
    await rig.kill(a);
    await rig.flushRedis();
    await pause(100);
    await rig.kill(b);
    const midway = await issued();
    // The kills really interrupted the issuing.
    expect(midway).toBeLessThan(passed.length);
    rig.startWorker();
    rig.startWorker();
    await until(
      async () =>
        (await issued()) === passed.length &&
        (await rig.db.enrollment.count({ where: { certificateDueAt: { not: null } } })) === 0,
      'all certificates',
    );
    await pause(1_000);

    const rows = await rig.db.certificate.findMany({
      where: { courseId: course.id },
      orderBy: { number: 'asc' },
    });
    expect(rows.map((row) => row.number)).toEqual(
      Array.from({ length: passed.length }, (_, i) => i + 1),
    );
    expect(rows.map((row) => row.enrollmentId).sort()).toEqual([...passed].sort());
    expect(new Set(rows.map((row) => row.verifyToken)).size).toBe(rows.length);
    expect(
      await rig.db.enrollment.count({
        where: { id: { in: cohorts.flatMap((c) => c.failed) }, status: 'completed' },
      }),
    ).toBe(9);
    const someone = await rig.db.enrollment.findUniqueOrThrow({
      where: { id: passed[0] ?? '' },
      include: { student: true },
    });
    await until(
      async () => (await rig.db.emailOutbox.count({ where: { status: { not: 'sent' } } })) === 0,
      'the emails',
    );
    expect(await inbox(someone.student.email)).toHaveLength(1);
    await assertInvariants(rig.db);
  });

  it('are not issued before the last lesson has ended', async () => {
    await rig.setTime(rig.start);
    const { course } = await rig.cohort(1);
    const { passed, cohort } = await finishedCohort(course.id, 2, 0);
    const worker = rig.startWorker();
    // The shared clock keeps running, so leave more than the pause as margin.
    await rig.setTime(new Date(END.getTime() - 10_000));
    await pause(1_500);
    expect(await rig.db.certificate.count({ where: { courseId: course.id } })).toBe(0);
    await rig.setTime(END);
    await until(
      async () => (await rig.db.certificate.count({ where: { courseId: course.id } })) === 2,
      'the certificates',
    );
    expect(
      (await rig.db.cohort.findUniqueOrThrow({ where: { id: cohort.id } })).completedAt,
    ).not.toBeNull();
    expect(passed).toHaveLength(2);
    await rig.kill(worker);
  });
});
