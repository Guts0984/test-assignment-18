import { z } from 'zod';
import {
  addDays,
  isoWeekday,
  localDateSchema,
  localTimeSchema,
  timeZoneSchema,
  zonedInstant,
} from './zoned';

export const MAX_LESSONS = 200;
export const DEFAULT_LESSON_MINUTES = 90;

export const lessonRuleSchema = z.strictObject({
  startDate: localDateSchema,
  weekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .refine((days) => new Set(days).size === days.length, { error: 'Weekdays must be unique' }),
  localTime: localTimeSchema,
  count: z.number().int().min(1).max(MAX_LESSONS),
  timeZone: timeZoneSchema,
  durationMinutes: z.number().int().min(15).max(480),
});
export type LessonRule = z.infer<typeof lessonRuleSchema>;

export type LessonTime = {
  readonly startsAt: Date;
  readonly endsAt: Date;
};

export type PlannedLesson = LessonTime & {
  readonly seq: number;
  readonly localDate: string;
  readonly localTime: string;
};

export const lessonTime = (
  localDate: string,
  localTime: string,
  timeZone: string,
  durationMinutes: number,
): LessonTime => {
  const startsAt = zonedInstant(localDate, localTime, timeZone);
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000) };
};

const lessonDates = (rule: LessonRule): readonly string[] => {
  const wanted = new Set(rule.weekdays);
  const dates: string[] = [];
  for (let date = rule.startDate; dates.length < rule.count; date = addDays(date, 1)) {
    if (wanted.has(isoWeekday(date))) dates.push(date);
  }
  return dates;
};

/** Expands a weekly rule into lessons whose local wall time never shifts across DST. */
export const generateLessons = (rule: LessonRule): readonly PlannedLesson[] =>
  lessonDates(rule).map((localDate, index) => ({
    seq: index + 1,
    localDate,
    localTime: rule.localTime,
    ...lessonTime(localDate, rule.localTime, rule.timeZone, rule.durationMinutes),
  }));
