import { formatInZone } from '@school/shared/schedule/display';
import { type Unit } from './context';
import { queueEmails } from './outbox';

export type ReminderOutcome = 'sent' | 'not_due' | 'obsolete' | 'missing';

/**
 * Turns a due reminder into one email per student, once. A reminder of an old lesson time, or
 * one whose moment has passed for good, is closed without sending.
 */
export const processReminder = async (
  unit: Unit,
  notificationId: string,
): Promise<ReminderOutcome> => {
  // Lesson moves lock the cohort; taking it first keeps a move and a send from interleaving.
  await unit.tx.$queryRaw`
    SELECT c.id FROM cohorts c JOIN lessons l ON l.cohort_id = c.id
      JOIN scheduled_notifications n ON n.lesson_id = l.id
     WHERE n.id = ${notificationId}::uuid FOR NO KEY UPDATE OF c`;
  const row = await unit.tx.scheduledNotification.findUnique({ where: { id: notificationId } });
  if (!row) return 'missing';
  if (row.status !== 'pending') return 'obsolete';
  if (row.dueAt > unit.now) return 'not_due';
  const lesson = await unit.tx.lesson.findUniqueOrThrow({
    where: { id: row.lessonId },
    include: { homework: true, cohort: { include: { course: true } } },
  });
  const close = (status: 'done' | 'cancelled') =>
    unit.tx.scheduledNotification.update({
      where: { id: row.id },
      data: { status, processedAt: unit.now },
    });
  const forDeadline = row.kind === 'deadline_24h';
  const moment = forDeadline ? lesson.homework?.deadlineAt : lesson.startsAt;
  if (lesson.version !== row.lessonVersion || !moment || moment <= unit.now) {
    await close('cancelled');
    return 'obsolete';
  }
  const students = await unit.tx.user.findMany({
    where: {
      enrollments: {
        some: {
          cohortId: lesson.cohortId,
          status: 'paid',
          // Nobody is reminded to hand in work that is already in.
          ...(forDeadline
            ? { submissions: { none: { homeworkId: lesson.homework?.id ?? '' } } }
            : {}),
        },
      },
    },
  });
  const { title } = lesson.cohort.course;
  const lead = row.kind === 'lesson_1h' ? 'in 1 hour' : 'in 24 hours';
  await queueEmails(
    unit,
    students.map((student) => {
      const when = `${formatInZone(moment, student.timeZone)} (${student.timeZone})`;
      return {
        schoolId: lesson.cohort.schoolId,
        dedupeKey: `reminder:${lesson.id}:${row.lessonVersion}:${row.kind}:${student.id}`,
        to: student.email,
        subject: forDeadline ? `Homework due ${lead}: ${title}` : `Lesson ${lead}: ${title}`,
        body: `Hello ${student.fullName},\n\n${
          forDeadline
            ? `Homework ${lesson.seq} is due ${when}.`
            : `Lesson ${lesson.seq} starts ${when}.`
        }\n`,
      };
    }),
  );
  await close('done');
  return 'sent';
};
