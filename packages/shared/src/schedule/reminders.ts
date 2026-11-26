export type ReminderKind = 'lesson_24h' | 'lesson_1h' | 'deadline_24h';

export type PlannedReminder = {
  readonly kind: ReminderKind;
  readonly dueAt: Date;
};

const HOUR = 3_600_000;

/**
 * The reminders to schedule for one version of a lesson. A reminder whose moment has passed is
 * dropped, except the one-hour reminder of a lesson that has not started: it is due at once.
 */
export const planReminders = (
  lesson: { readonly startsAt: Date; readonly deadlineAt: Date },
  now: Date,
): readonly PlannedReminder[] => {
  const all: readonly PlannedReminder[] = [
    { kind: 'lesson_24h', dueAt: new Date(lesson.startsAt.getTime() - 24 * HOUR) },
    { kind: 'lesson_1h', dueAt: new Date(lesson.startsAt.getTime() - HOUR) },
    { kind: 'deadline_24h', dueAt: new Date(lesson.deadlineAt.getTime() - 24 * HOUR) },
  ];
  return all.filter(
    (reminder) => reminder.dueAt > now || (reminder.kind === 'lesson_1h' && lesson.startsAt > now),
  );
};
