import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findViolations } from '../src/invariants/assert';
import { sqlStateOf, SQLSTATE } from '../src/errors';
import { journalSeats, SYSTEM_ACTOR } from '../src/repo/seat-journal';
import { createTestDatabase, type TestDatabase } from '../src/testing/database';
import { AT, createCohort, createEnrollment, createUser } from '../src/testing/factories';
import { inTransaction } from '../src/transaction';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase(process.env['DATABASE_URL'] ?? '');
});
afterAll(async () => {
  await database.drop();
});

const rejectsWith = async (work: Promise<unknown>, state: string): Promise<void> => {
  const error: unknown = await work.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error, 'the statement must be rejected').toBeDefined();
  expect(`${sqlStateOf(error) ?? ''} ${String(error)}`).toContain(state);
};

const sql = (statement: string) => database.db.$executeRawUnsafe(statement);

describe('seat counters', () => {
  it('follow the journal and cannot be written directly', async () => {
    const { cohort } = await createCohort(database.db, { capacity: 3 });
    await createEnrollment(database.db, cohort);
    const stored = await database.db.cohort.findUniqueOrThrow({ where: { id: cohort.id } });
    expect([stored.capacity, stored.seatsTaken]).toEqual([3, 1]);

    for (const change of ['seats_taken = 0', 'capacity = 100']) {
      await rejectsWith(
        sql(`UPDATE cohorts SET ${change} WHERE id = '${cohort.id}'`),
        SQLSTATE.restrictViolation,
      );
    }
    expect(await findViolations(database.db)).toEqual([]);
  });

  it('refuse a seat beyond capacity, even with no application check', async () => {
    const { cohort } = await createCohort(database.db, { capacity: 1 });
    await createEnrollment(database.db, cohort);
    await rejectsWith(createEnrollment(database.db, cohort), SQLSTATE.checkViolation);
  });

  it('let exactly the capacity through when 30 transactions race without locks', async () => {
    const { cohort } = await createCohort(database.db, { capacity: 4 });
    const students = await Promise.all(Array.from({ length: 30 }, () => createUser(database.db)));
    const results = await Promise.allSettled(
      students.map((student) => createEnrollment(database.db, cohort, { studentId: student.id })),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(4);
    expect(await findViolations(database.db)).toEqual([]);
  });

  it('refuse a capacity below the seats already taken', async () => {
    const { cohort } = await createCohort(database.db, { capacity: 2 });
    await createEnrollment(database.db, cohort);
    await createEnrollment(database.db, cohort);
    await rejectsWith(
      sql(`INSERT INTO seat_journal (cohort_id, seats_delta, capacity_delta, reason, actor_kind, at)
           VALUES ('${cohort.id}', 0, -1, 'capacity', 'manager', now())`),
      SQLSTATE.checkViolation,
    );
  });

  it('cannot commit a status change that has no journal row', async () => {
    const { cohort } = await createCohort(database.db);
    const enrollment = await createEnrollment(database.db, cohort);
    await rejectsWith(
      database.db.enrollment.update({ where: { id: enrollment.id }, data: { status: 'expired' } }),
      'journal',
    );
  });

  it('cannot journal a seat that no status change explains', async () => {
    const { cohort } = await createCohort(database.db);
    const enrollment = await createEnrollment(database.db, cohort);
    await rejectsWith(
      inTransaction(database.db, (tx) =>
        journalSeats(tx, {
          cohortId: cohort.id,
          enrollmentId: enrollment.id,
          seatsDelta: -1,
          reason: 'expiry',
          actor: SYSTEM_ACTOR,
          at: AT,
        }),
      ),
      'journal',
    );
  });

  it('cannot move an enrollment to another cohort or student', async () => {
    const { cohort } = await createCohort(database.db);
    const other = await createCohort(database.db);
    const enrollment = await createEnrollment(database.db, cohort);
    await rejectsWith(
      sql(`UPDATE enrollments SET cohort_id = '${other.cohort.id}' WHERE id = '${enrollment.id}'`),
      SQLSTATE.restrictViolation,
    );
  });

  it.each([
    'UPDATE seat_journal SET seats_delta = 0',
    'DELETE FROM seat_journal',
    'TRUNCATE seat_journal',
  ])('keep the journal append-only: %s', async (statement) => {
    await createCohort(database.db);
    await rejectsWith(sql(statement), SQLSTATE.restrictViolation);
  });
});

describe('uniqueness', () => {
  it('allows one active enrollment per student and cohort, and another once it ends', async () => {
    const { cohort } = await createCohort(database.db);
    const student = await createUser(database.db);
    await createEnrollment(database.db, cohort, { studentId: student.id });
    await rejectsWith(
      createEnrollment(database.db, cohort, { studentId: student.id }),
      SQLSTATE.uniqueViolation,
    );
    await expect(
      createEnrollment(database.db, cohort, { studentId: student.id, status: 'cancelled' }),
    ).resolves.toBeDefined();
  });

  it('allows one active waitlist entry per student and cohort', async () => {
    const { cohort } = await createCohort(database.db);
    const student = await createUser(database.db);
    const join = () =>
      database.db.waitlistEntry.create({
        data: { cohortId: cohort.id, studentId: student.id, status: 'waiting', joinedAt: AT },
      });
    await join();
    await rejectsWith(join(), SQLSTATE.uniqueViolation);
  });
});

describe('value checks', () => {
  it('ties a staff role to a school and a student to none', async () => {
    await rejectsWith(createUser(database.db, { role: 'manager' }), SQLSTATE.checkViolation);
    const { school } = await createCohort(database.db);
    await rejectsWith(createUser(database.db, { schoolId: school.id }), SQLSTATE.checkViolation);
  });

  it('keeps a reviewer exactly while work is in review', async () => {
    const { cohort, mentor } = await createCohort(database.db);
    const enrollment = await createEnrollment(database.db, cohort, { status: 'paid' });
    const lesson = await database.db.lesson.create({
      data: {
        cohortId: cohort.id,
        seq: 1,
        localDate: new Date('2026-04-07'),
        localTime: '19:00',
        startsAt: new Date('2026-04-07T16:00:00Z'),
        endsAt: new Date('2026-04-07T17:30:00Z'),
        homework: {
          create: { cohortId: cohort.id, title: 'H1', deadlineAt: new Date('2026-04-14') },
        },
      },
      include: { homework: true },
    });
    const submit = (status: string, reviewerId: string | null) =>
      database.db.submission.create({
        data: {
          homeworkId: lesson.homework?.id ?? '',
          enrollmentId: enrollment.id,
          studentId: enrollment.studentId,
          cohortId: cohort.id,
          status,
          reviewerId,
          body: 'answer',
          submittedAt: AT,
          isLate: false,
        },
      });
    await rejectsWith(submit('in_review', null), SQLSTATE.checkViolation);
    await rejectsWith(submit('submitted', mentor.id), SQLSTATE.checkViolation);
    await expect(submit('in_review', mentor.id)).resolves.toBeDefined();
  });

  it('never lets a promo exceed its limit, and counts only through redemptions', async () => {
    const { cohort, school } = await createCohort(database.db);
    const promo = await database.db.promoCode.create({
      data: {
        schoolId: school.id,
        code: 'ONE',
        discountKind: 'percent',
        percent: 10,
        validFrom: AT,
        validUntil: new Date('2027-01-01'),
        maxUses: 1,
      },
    });
    const reserve = async () => {
      const enrollment = await createEnrollment(database.db, cohort);
      return database.db.promoRedemption.create({
        data: {
          enrollmentId: enrollment.id,
          promoId: promo.id,
          state: 'reserved',
          discountMinor: 1_000,
          updatedAt: AT,
        },
      });
    };
    await reserve();
    await rejectsWith(reserve(), SQLSTATE.checkViolation);
    await rejectsWith(
      sql(`UPDATE promo_codes SET reserved_count = 0 WHERE id = '${promo.id}'`),
      SQLSTATE.restrictViolation,
    );
    await database.db.promoRedemption.updateMany({
      where: { promoId: promo.id },
      data: { state: 'released' },
    });
    await expect(reserve()).resolves.toBeDefined();
    expect(await findViolations(database.db)).toEqual([]);
  });
});

describe('certificate numbers', () => {
  const issue = (courseId: string, enrollmentId: string, studentId: string, number: number) =>
    database.db.certificate.create({
      data: {
        courseId,
        enrollmentId,
        studentId,
        number,
        verifyToken: `${enrollmentId}-${number}`,
        issuedAt: AT,
      },
    });

  it('are consecutive: gaps, repeats and rollbacks leave no hole', async () => {
    const { cohort, course } = await createCohort(database.db);
    const [first, second] = await Promise.all([
      createEnrollment(database.db, cohort, { status: 'completed' }),
      createEnrollment(database.db, cohort, { status: 'completed' }),
    ]);
    await rejectsWith(issue(course.id, first.id, first.studentId, 2), SQLSTATE.checkViolation);
    await issue(course.id, first.id, first.studentId, 1);
    // The same enrollment again, with the next number: rejected without consuming it.
    await rejectsWith(issue(course.id, first.id, first.studentId, 2), SQLSTATE.uniqueViolation);
    await rejectsWith(issue(course.id, second.id, second.studentId, 1), SQLSTATE.uniqueViolation);
    await expect(issue(course.id, second.id, second.studentId, 2)).resolves.toBeDefined();
    await rejectsWith(sql('DELETE FROM certificates'), SQLSTATE.restrictViolation);
    expect(await findViolations(database.db)).toEqual([]);
  });
});
