import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatInZone, toZonedParts } from './display';
import { generateLessons, lessonRuleSchema, type LessonRule } from './generate';
import { addDays, isoWeekday } from './zoned';

// «по вторникам и четвергам в 19:00 по Киеву, 12 занятий», across the 29 March 2026 switch.
const rule: LessonRule = {
  startDate: '2026-03-23',
  weekdays: [2, 4],
  localTime: '19:00',
  count: 12,
  timeZone: 'Europe/Kyiv',
  durationMinutes: 90,
};

describe('generateLessons', () => {
  const lessons = generateLessons(rule);

  it('creates exactly the requested Tuesdays and Thursdays', () => {
    expect(lessons).toHaveLength(12);
    expect(lessons.map((lesson) => lesson.seq)).toEqual([...Array(12).keys()].map((i) => i + 1));
    expect(lessons[0]?.localDate).toBe('2026-03-24');
    expect(lessons.at(-1)?.localDate).toBe('2026-04-30');
    expect(lessons.every((lesson) => [2, 4].includes(isoWeekday(lesson.localDate)))).toBe(true);
  });

  it('stays at 19:00 Kyiv while the UTC time shifts with daylight saving', () => {
    expect(lessons.map((l) => toZonedParts(l.startsAt, 'Europe/Kyiv').time)).toEqual(
      Array(12).fill('19:00'),
    );
    expect(lessons[1]?.startsAt.toISOString()).toBe('2026-03-26T17:00:00.000Z');
    expect(lessons[2]?.startsAt.toISOString()).toBe('2026-03-31T16:00:00.000Z');
  });

  it('shows a student in New York their own wall time, which shifts on different weeks', () => {
    const seen = lessons.map((l) => toZonedParts(l.startsAt, 'America/New_York').time);
    expect(seen[0]).toBe('13:00');
    expect(seen[2]).toBe('12:00');
    const first = lessons[0];
    expect(first && formatInZone(first.startsAt, 'America/New_York')).toContain('13:00');
  });

  it('counts the duration in real minutes', () => {
    for (const lesson of lessons) {
      expect(lesson.endsAt.getTime() - lesson.startsAt.getTime()).toBe(90 * 60_000);
    }
  });

  it('keeps the rule time and strictly increasing order for any rule', () => {
    fc.assert(
      fc.property(
        fc.record({
          startDate: fc.integer({ min: 0, max: 1_000 }).map((d) => addDays('2025-01-01', d)),
          weekdays: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 }),
          localTime: fc.constantFrom('08:00', '13:30', '19:00', '23:15'),
          count: fc.integer({ min: 1, max: 40 }),
          timeZone: fc.constantFrom('Europe/Kyiv', 'Europe/Warsaw', 'America/New_York'),
          durationMinutes: fc.constant(90),
        }),
        (random) => {
          const result = generateLessons(random);
          expect(result).toHaveLength(random.count);
          result.forEach((lesson, index) => {
            expect(toZonedParts(lesson.startsAt, random.timeZone).time).toBe(random.localTime);
            expect(random.weekdays).toContain(isoWeekday(lesson.localDate));
            expect(lesson.localDate >= random.startDate).toBe(true);
            const previous = result[index - 1];
            if (previous) expect(lesson.startsAt > previous.startsAt).toBe(true);
          });
        },
      ),
    );
  });

  it.each([
    { weekdays: [] },
    { weekdays: [0] },
    { weekdays: [2, 2] },
    { count: 0 },
    { count: 201 },
    { count: 1.5 },
    { durationMinutes: 0 },
    { startDate: '2026-02-30' },
    { timeZone: 'Nowhere' },
    { extra: true },
  ])('rejects the rule override %o', (override) => {
    expect(lessonRuleSchema.safeParse({ ...rule, ...override }).success).toBe(false);
  });
});
