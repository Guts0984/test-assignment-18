import { addDays, zonedInstant } from '../schedule/zoned';

export const HOMEWORK_DAYS = 7;
const LAST_TIME = '23:59';
const REST_OF_MINUTE_MS = 59_999;

/** 23:59 (to the end of that minute) cohort-local, seven days after the lesson's local date. */
export const homeworkDeadline = (lessonLocalDate: string, timeZone: string): Date =>
  new Date(
    zonedInstant(addDays(lessonLocalDate, HOMEWORK_DAYS), LAST_TIME, timeZone).getTime() +
      REST_OF_MINUTE_MS,
  );

export const isLate = (submittedAt: Date, deadline: Date): boolean => submittedAt > deadline;
