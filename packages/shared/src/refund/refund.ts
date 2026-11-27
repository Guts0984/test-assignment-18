import { percentOf } from '../money/money';
import { type LessonTime } from '../schedule/generate';
import { zonedInstant } from '../schedule/zoned';

export type RefundBoundaries = {
  readonly cohortStartsAt: Date;
  /** Null when the cohort has no lessons yet. */
  readonly thirdLessonStartsAt: Date | null;
};

export type RefundPercent = 100 | 50 | 0;
export type RefundPolicy = 'rule' | 'full';

/**
 * The cohort starts with its earliest lesson. With fewer than three lessons the second
 * boundary is the end of the last one.
 */
export const refundBoundaries = (input: {
  readonly lessons: readonly LessonTime[];
  readonly startDate: string;
  readonly timeZone: string;
}): RefundBoundaries => {
  const ordered = [...input.lessons].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const first = ordered[0];
  if (first === undefined) {
    return {
      cohortStartsAt: zonedInstant(input.startDate, '00:00', input.timeZone),
      thirdLessonStartsAt: null,
    };
  }
  const third = ordered[2]?.startsAt ?? ordered.at(-1)?.endsAt ?? null;
  return { cohortStartsAt: first.startsAt, thirdLessonStartsAt: third };
};

export const refundPercent = (cancelAt: Date, boundaries: RefundBoundaries): RefundPercent => {
  if (cancelAt < boundaries.cohortStartsAt) return 100;
  const third = boundaries.thirdLessonStartsAt;
  return third === null || cancelAt < third ? 50 : 0;
};

/** A transferred enrollment never gets back more than the one it came from still could. */
export const cappedPercent = (percent: RefundPercent, cap: RefundPercent): RefundPercent =>
  percent < cap ? percent : cap;

/** The amount to return, rounded down and never above what was actually paid. */
export const refundAmount = (input: {
  readonly netPaidMinor: number;
  readonly percent: RefundPercent;
  readonly policy: RefundPolicy;
}): number => {
  const paid = Math.max(0, input.netPaidMinor);
  return input.policy === 'full' ? paid : percentOf(paid, input.percent);
};
