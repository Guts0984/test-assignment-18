import { randomUUID } from 'node:crypto';
import { type EnrollmentStatus, occupiesSeat } from '@school/shared/status/enrollment';
import { type Role } from '@school/shared/status/actors';
import { type School, type User } from '@prisma/client';
import { type Db } from '../client';
import { journalCapacity, journalSeats, SYSTEM_ACTOR } from '../repo/seat-journal';
import { inTransaction } from '../transaction';

export const AT = new Date('2026-03-01T10:00:00.000Z');

export const createSchool = (db: Db): Promise<School> =>
  db.school.create({ data: { name: `School ${randomUUID()}` } });

export const createUser = (
  db: Db,
  input: { readonly role?: Role; readonly schoolId?: string; readonly passwordHash?: string } = {},
): Promise<User> => {
  const id = randomUUID();
  return db.user.create({
    data: {
      id,
      email: `user-${id}@example.test`,
      fullName: `User ${id.slice(0, 8)}`,
      passwordHash: input.passwordHash ?? 'unusable',
      role: input.role ?? 'student',
      schoolId: input.schoolId ?? null,
    },
  });
};

/** A school with one course, one mentor and one cohort. */
export const createCohort = async (
  db: Db,
  input: { readonly capacity?: number; readonly priceMinor?: number } = {},
) => {
  const school = await createSchool(db);
  const mentor = await createUser(db, { role: 'mentor', schoolId: school.id });
  const course = await db.course.create({
    data: { schoolId: school.id, title: 'TypeScript', direction: 'programming' },
  });
  const cohort = await db.cohort.create({
    data: {
      courseId: course.id,
      schoolId: school.id,
      mentorId: mentor.id,
      startDate: new Date('2026-04-07'),
      startsAt: new Date('2026-04-07T16:00:00Z'),
      timeZone: 'Europe/Kyiv',
      priceMinor: input.priceMinor ?? 10_000,
      currency: 'UAH',
    },
  });
  const capacity = input.capacity ?? 10;
  if (capacity > 0) {
    await inTransaction(db, (tx) =>
      journalCapacity(tx, {
        cohortId: cohort.id,
        capacityDelta: capacity,
        actor: SYSTEM_ACTOR,
        at: AT,
      }),
    );
  }
  return { school, mentor, course, cohort };
};

/** Inserts an enrollment together with the journal row its status requires. */
export const createEnrollment = async (
  db: Db,
  cohort: { readonly id: string; readonly priceMinor: number },
  input: { readonly status?: EnrollmentStatus; readonly studentId?: string } = {},
) => {
  const status = input.status ?? 'held';
  const studentId = input.studentId ?? (await createUser(db)).id;
  return inTransaction(db, async (tx) => {
    const enrollment = await tx.enrollment.create({
      data: {
        cohortId: cohort.id,
        studentId,
        status,
        listPriceMinor: cohort.priceMinor,
        priceMinor: cohort.priceMinor,
        currency: 'UAH',
        holdExpiresAt: new Date(AT.getTime() + 900_000),
        createdAt: AT,
        updatedAt: AT,
      },
    });
    if (occupiesSeat(status)) {
      await journalSeats(tx, {
        cohortId: cohort.id,
        enrollmentId: enrollment.id,
        seatsDelta: 1,
        reason: 'hold',
        actor: SYSTEM_ACTOR,
        at: AT,
      });
    }
    return enrollment;
  });
};
