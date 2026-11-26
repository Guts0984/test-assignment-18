import { homeworkDeadline } from '@school/shared/homework/deadline';
import { generateLessons, lessonTime } from '@school/shared/schedule/generate';
import { planReminders } from '@school/shared/schedule/reminders';
import { type CreateCohortInput } from '@school/shared/schemas/manage';
import { type Tx } from '../client';
import { journalCapacity, type ActorRef } from './seat-journal';

const dateOnly = (localDate: string): Date => new Date(`${localDate}T00:00:00.000Z`);

const scheduleReminders = async (
  tx: Tx,
  lesson: { readonly id: string; readonly version: number },
  times: { readonly startsAt: Date; readonly deadlineAt: Date },
  now: Date,
): Promise<void> => {
  await tx.scheduledNotification.createMany({
    data: planReminders(times, now).map((reminder) => ({
      ...reminder,
      lessonId: lesson.id,
      lessonVersion: lesson.version,
    })),
  });
};

/** Creates a cohort with its lessons, homework, reminders and opening capacity. */
export const createCohortWithSchedule = async (
  tx: Tx,
  input: CreateCohortInput & { readonly schoolId: string },
  context: { readonly actor: ActorRef; readonly now: Date },
): Promise<string> => {
  const planned = generateLessons({
    ...input.schedule,
    startDate: input.startDate,
    timeZone: input.timeZone,
    durationMinutes: input.lessonMinutes,
  });
  const first = planned[0];
  const last = planned.at(-1);
  if (!first || !last) throw new Error('A schedule produces at least one lesson');
  const cohort = await tx.cohort.create({
    data: {
      courseId: input.courseId,
      schoolId: input.schoolId,
      mentorId: input.mentorId,
      startDate: dateOnly(first.localDate),
      timeZone: input.timeZone,
      priceMinor: input.priceMinor,
      currency: input.currency,
      lessonMinutes: input.lessonMinutes,
      startsAt: first.startsAt,
      endsAt: last.endsAt,
      createdAt: context.now,
    },
  });
  for (const plan of planned) {
    const deadlineAt = homeworkDeadline(plan.localDate, input.timeZone);
    const lesson = await tx.lesson.create({
      data: {
        cohortId: cohort.id,
        seq: plan.seq,
        localDate: dateOnly(plan.localDate),
        localTime: plan.localTime,
        startsAt: plan.startsAt,
        endsAt: plan.endsAt,
        homework: {
          create: { cohortId: cohort.id, title: `Homework ${plan.seq}`, deadlineAt },
        },
      },
    });
    await scheduleReminders(tx, lesson, { startsAt: plan.startsAt, deadlineAt }, context.now);
  }
  await journalCapacity(tx, {
    cohortId: cohort.id,
    capacityDelta: input.capacity,
    actor: context.actor,
    at: context.now,
  });
  return cohort.id;
};

export type RescheduleRejection = 'NOT_FOUND' | 'LESSON_STARTED' | 'IN_THE_PAST';

/**
 * Moves one lesson. Its version grows, so reminders of the old time are cancelled and can never
 * be sent, and the homework deadline and the cohort's span follow.
 */
export const rescheduleLesson = async (
  tx: Tx,
  input: {
    readonly lessonId: string;
    readonly schoolId: string;
    readonly localDate: string;
    readonly localTime: string;
    readonly now: Date;
  },
): Promise<{ readonly cohortId: string } | RescheduleRejection> => {
  // Cohort first, then lesson: the order every writer of a cohort follows.
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM cohorts c JOIN lessons l ON l.cohort_id = c.id
     WHERE l.id = ${input.lessonId}::uuid AND c.school_id = ${input.schoolId}::uuid
       FOR NO KEY UPDATE OF c`;
  if (locked.length === 0) return 'NOT_FOUND';
  const lesson = await tx.lesson.findUniqueOrThrow({
    where: { id: input.lessonId },
    include: { cohort: true },
  });
  if (lesson.startsAt <= input.now) return 'LESSON_STARTED';
  const { timeZone, lessonMinutes } = lesson.cohort;
  const times = lessonTime(input.localDate, input.localTime, timeZone, lessonMinutes);
  if (times.startsAt <= input.now) return 'IN_THE_PAST';
  if (times.startsAt.getTime() === lesson.startsAt.getTime()) return { cohortId: lesson.cohortId };

  const deadlineAt = homeworkDeadline(input.localDate, timeZone);
  const updated = await tx.lesson.update({
    where: { id: lesson.id },
    data: {
      ...times,
      localDate: dateOnly(input.localDate),
      localTime: input.localTime,
      version: { increment: 1 },
      homework: { update: { deadlineAt } },
    },
  });
  await tx.scheduledNotification.updateMany({
    where: { lessonId: lesson.id, status: 'pending' },
    data: { status: 'cancelled', processedAt: input.now },
  });
  await scheduleReminders(tx, updated, { startsAt: times.startsAt, deadlineAt }, input.now);
  await tx.$executeRaw`
    UPDATE cohorts c SET starts_at = l.starts_at, ends_at = l.ends_at, start_date = l.local_date
      FROM (SELECT min(starts_at) AS starts_at, max(ends_at) AS ends_at,
                   min(local_date) AS local_date
              FROM lessons WHERE cohort_id = ${lesson.cohortId}::uuid) l
     WHERE c.id = ${lesson.cohortId}::uuid`;
  return { cohortId: lesson.cohortId };
};
