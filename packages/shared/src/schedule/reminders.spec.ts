import { describe, expect, it } from 'vitest';
import { planReminders } from './reminders';

const lesson = {
  startsAt: new Date('2026-03-31T16:00:00Z'),
  deadlineAt: new Date('2026-04-07T20:59:59.999Z'),
};
const kinds = (now: string) => planReminders(lesson, new Date(now)).map((r) => r.kind);

describe('planReminders', () => {
  it('schedules 24 hours and 1 hour before the lesson, and 24 hours before the deadline', () => {
    expect(
      planReminders(lesson, new Date('2026-03-01T00:00:00Z')).map((r) => r.dueAt.toISOString()),
    ).toEqual(['2026-03-30T16:00:00.000Z', '2026-03-31T15:00:00.000Z', '2026-04-06T20:59:59.999Z']);
  });

  it('drops the day-ahead reminder once its moment has passed', () => {
    expect(kinds('2026-03-30T16:00:00Z')).toEqual(['lesson_1h', 'deadline_24h']);
  });

  it('keeps the hour reminder for a lesson moved to less than an hour ahead', () => {
    expect(kinds('2026-03-31T15:30:00Z')).toEqual(['lesson_1h', 'deadline_24h']);
  });

  it('sends nothing about a lesson that has started', () => {
    expect(kinds('2026-03-31T16:00:00Z')).toEqual(['deadline_24h']);
  });
});
