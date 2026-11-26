import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { generateLessons } from '../schedule/generate';
import { refundAmount, refundBoundaries, refundPercent } from './refund';

const timeZone = 'America/New_York';
// Starts Tuesday 27 October 2026 (EDT); the third lesson is after the 1 November switch (EST).
const lessons = generateLessons({
  startDate: '2026-10-27',
  weekdays: [2, 4],
  localTime: '19:00',
  count: 6,
  timeZone,
  durationMinutes: 90,
});
const boundaries = refundBoundaries({ lessons, startDate: '2026-10-27', timeZone });
const start = Date.parse('2026-10-27T23:00:00.000Z');
const third = Date.parse('2026-11-04T00:00:00.000Z');
const at = (ms: number) => refundPercent(new Date(ms), boundaries);

describe('refund percent', () => {
  it('places the boundaries at the New York wall times', () => {
    expect(boundaries.cohortStartsAt.getTime()).toBe(start);
    expect(boundaries.thirdLessonStartsAt?.getTime()).toBe(third);
  });

  it.each([
    [start - 60_000, 100],
    [start - 1, 100],
    [start, 50],
    [start + 60_000, 50],
    [third - 1, 50],
    [third, 0],
    [third + 1_000, 0],
  ])('at %d returns %d%%', (instant, percent) => {
    expect(at(instant)).toBe(percent);
  });

  it('never grows as time passes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: start - 10_000_000, max: third + 10_000_000 }),
        fc.nat(10_000_000),
        (instant, later) => {
          expect(at(instant + later)).toBeLessThanOrEqual(at(instant));
        },
      ),
    );
  });

  it('orders lessons by their actual time, so a moved lesson changes the boundary', () => {
    const [first, second, thirdLesson, fourth] = lessons;
    if (!first || !second || !thirdLesson || !fourth) throw new Error('fixture');
    const postponed = { ...thirdLesson, startsAt: new Date('2026-12-01T00:00:00Z') };
    const moved = refundBoundaries({
      lessons: [fourth, postponed, second, first],
      startDate: '2026-10-27',
      timeZone,
    });
    expect(moved.cohortStartsAt).toEqual(first.startsAt);
    expect(moved.thirdLessonStartsAt).toEqual(fourth.startsAt);
  });

  it('uses the end of the last lesson when there are fewer than three', () => {
    const two = lessons.slice(0, 2);
    const short = refundBoundaries({ lessons: two, startDate: '2026-10-27', timeZone });
    expect(short.thirdLessonStartsAt).toEqual(two[1]?.endsAt);
  });

  it('starts a cohort without lessons at local midnight of its start date', () => {
    const empty = refundBoundaries({ lessons: [], startDate: '2026-10-27', timeZone });
    expect(empty.cohortStartsAt.toISOString()).toBe('2026-10-27T04:00:00.000Z');
    expect(refundPercent(new Date('2027-01-01T00:00:00Z'), empty)).toBe(50);
  });
});

describe('refund amount', () => {
  it('rounds half of an odd amount down', () => {
    expect(refundAmount({ netPaidMinor: 999, percent: 50, policy: 'rule' })).toBe(499);
  });

  it('returns everything under the full policy even after the start', () => {
    expect(refundAmount({ netPaidMinor: 999, percent: 0, policy: 'full' })).toBe(999);
  });

  it('stays between zero and what was paid', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000, max: 1_000_000_000 }),
        fc.constantFrom(100 as const, 50 as const, 0 as const),
        fc.constantFrom('rule' as const, 'full' as const),
        (netPaidMinor, percent, policy) => {
          const amount = refundAmount({ netPaidMinor, percent, policy });
          expect(Number.isInteger(amount)).toBe(true);
          expect(amount).toBeGreaterThanOrEqual(0);
          expect(amount).toBeLessThanOrEqual(Math.max(0, netPaidMinor));
        },
      ),
    );
  });
});
