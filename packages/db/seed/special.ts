import { addDays, isoWeekday } from '@school/shared/schedule/zoned';
import { generateLessons } from '@school/shared/schedule/generate';
import { toZonedParts } from '@school/shared/schedule/display';
import { type Tx } from '../src/client';
import { journalCapacity, journalSeats, SYSTEM_ACTOR } from '../src/repo/seat-journal';
import { seedId } from './ids';
import { NEAR_COHORTS, type SeedSizes } from './sizes';

const ZONES = ['Europe/Kyiv', 'Europe/Warsaw', 'America/New_York'] as const;
const NEAR_CAPACITY = 20;
const WAITING = 8;

type Shape = {
  readonly key: string;
  readonly course: number;
  readonly timeZone: string;
  readonly startDate: string;
  readonly lessons: number;
  readonly capacity: number;
  readonly paid: number;
  readonly waiting: number;
};

/** The next date on which the zone's UTC offset differs from the day before. */
export const nextTransitionDate = (timeZone: string, from: Date): string => {
  const noon = (date: string) => toZonedParts(new Date(`${date}T12:00:00Z`), timeZone).offset;
  let date = toZonedParts(from, timeZone).date;
  for (let day = 0; day < 400; day += 1) {
    const next = addDays(date, 1);
    if (noon(next) !== noon(date)) return next;
    date = next;
  }
  throw new Error(`No offset change within a year for ${timeZone}`);
};

/**
 * Cohorts starting within days, half with two free seats and half full with a waitlist, and one
 * cohort per time zone whose twelve lessons surround the next daylight saving change.
 */
export const specialShapes = (now: Date): readonly Shape[] => {
  const today = now.toISOString().slice(0, 10);
  const near = Array.from({ length: NEAR_COHORTS }, (_, i): Shape => {
    const full = i % 2 === 1;
    return {
      key: `near-${i}`,
      course: i,
      timeZone: ZONES[i % 3] ?? ZONES[0],
      startDate: addDays(today, 2 + i),
      lessons: 6,
      capacity: NEAR_CAPACITY,
      paid: full ? NEAR_CAPACITY : NEAR_CAPACITY - 2,
      waiting: full ? WAITING : 0,
    };
  });
  const dst = ZONES.map((timeZone, i): Shape => {
    const change = nextTransitionDate(timeZone, new Date(now.getTime() + 22 * 86_400_000));
    // Three weeks before the change, so lessons fall on both sides of it.
    const startDate = addDays(change, -20 - isoWeekday(change));
    return {
      key: `dst-${i}`,
      course: NEAR_COHORTS + i,
      timeZone,
      startDate,
      lessons: 12,
      capacity: 15,
      paid: 5,
      waiting: 0,
    };
  });
  return [...near, ...dst];
};

const insertCohort = async (
  tx: Tx,
  shape: Shape,
  index: number,
  courseCount: number,
  now: Date,
) => {
  const courseId = seedId(`course-${shape.course % courseCount}`);
  const course = await tx.course.findUniqueOrThrow({ where: { id: courseId } });
  const lessons = generateLessons({
    startDate: shape.startDate,
    weekdays: [2, 4],
    localTime: '19:00',
    count: shape.lessons,
    timeZone: shape.timeZone,
    durationMinutes: 90,
  });
  const school = await tx.school.findUniqueOrThrow({ where: { id: course.schoolId } });
  const mentor = await tx.user.findFirstOrThrow({
    where: { schoolId: school.id, role: 'mentor' },
    orderBy: { email: 'asc' },
  });
  const first = lessons[0];
  const last = lessons.at(-1);
  if (!first || !last) throw new Error('A seeded cohort needs lessons');
  const cohort = await tx.cohort.create({
    data: {
      id: seedId(`special-cohort-${shape.key}`),
      courseId,
      schoolId: school.id,
      mentorId: mentor.id,
      startDate: new Date(`${first.localDate}T00:00:00Z`),
      timeZone: shape.timeZone,
      priceMinor: 25_000 + index * 100,
      currency: (['UAH', 'EUR', 'USD'] as const)[index % 3] ?? 'UAH',
      startsAt: first.startsAt,
      endsAt: last.endsAt,
      createdAt: now,
    },
  });
  await tx.lesson.createMany({
    data: lessons.map((lesson) => ({
      id: seedId(`special-lesson-${shape.key}-${lesson.seq}`),
      cohortId: cohort.id,
      seq: lesson.seq,
      localDate: new Date(`${lesson.localDate}T00:00:00Z`),
      localTime: lesson.localTime,
      startsAt: lesson.startsAt,
      endsAt: lesson.endsAt,
    })),
  });
  await journalCapacity(tx, {
    cohortId: cohort.id,
    capacityDelta: shape.capacity,
    actor: SYSTEM_ACTOR,
    at: now,
  });
  return cohort;
};

export const seedSpecialCohorts = async (tx: Tx, sizes: SeedSizes, now: Date): Promise<void> => {
  for (const [index, shape] of specialShapes(now).entries()) {
    const cohort = await insertCohort(tx, shape, index, sizes.courses, now);
    const student = (n: number) => seedId(`student-${1 + ((index * 40 + n) % sizes.students)}`);
    for (let n = 0; n < shape.paid; n += 1) {
      const enrollment = await tx.enrollment.create({
        data: {
          cohortId: cohort.id,
          studentId: student(n),
          status: 'paid',
          listPriceMinor: cohort.priceMinor,
          priceMinor: cohort.priceMinor,
          currency: cohort.currency,
          holdExpiresAt: now,
          createdAt: now,
          updatedAt: now,
          paidAt: now,
        },
      });
      await journalSeats(tx, {
        cohortId: cohort.id,
        enrollmentId: enrollment.id,
        seatsDelta: 1,
        reason: 'hold',
        actor: SYSTEM_ACTOR,
        at: now,
      });
      await tx.moneyOperation.create({
        data: {
          enrollmentId: enrollment.id,
          kind: 'payment',
          amountMinor: cohort.priceMinor,
          currency: cohort.currency,
          providerPaymentId: `seed-${enrollment.id}`,
          createdAt: now,
        },
      });
    }
    await tx.waitlistEntry.createMany({
      data: Array.from({ length: shape.waiting }, (_, n) => ({
        cohortId: cohort.id,
        studentId: student(shape.paid + n),
        status: 'waiting',
        joinedAt: new Date(now.getTime() - (shape.waiting - n) * 60_000),
      })),
    });
  }
};
