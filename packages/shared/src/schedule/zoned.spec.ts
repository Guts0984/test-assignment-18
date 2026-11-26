import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toZonedParts } from './display';
import { addDays, isoWeekday, localTimeSchema, timeZoneSchema, zonedInstant } from './zoned';

const iso = (date: string, time: string, zone: string) =>
  zonedInstant(date, time, zone).toISOString();

describe('zonedInstant', () => {
  it('uses the offset in force on that date', () => {
    expect(iso('2026-03-26', '19:00', 'Europe/Kyiv')).toBe('2026-03-26T17:00:00.000Z');
    expect(iso('2026-03-31', '19:00', 'Europe/Kyiv')).toBe('2026-03-31T16:00:00.000Z');
    expect(iso('2026-03-06', '19:00', 'America/New_York')).toBe('2026-03-07T00:00:00.000Z');
    expect(iso('2026-03-09', '19:00', 'America/New_York')).toBe('2026-03-09T23:00:00.000Z');
  });

  it.each([
    // Wall time that does not exist resolves to the first instant after the gap.
    ['2026-03-29', '03:00', 'Europe/Kyiv', '2026-03-29T01:00:00.000Z'],
    ['2026-03-29', '03:30', 'Europe/Kyiv', '2026-03-29T01:00:00.000Z'],
    ['2026-03-29', '02:30', 'Europe/Warsaw', '2026-03-29T01:00:00.000Z'],
    ['2026-03-08', '02:30', 'America/New_York', '2026-03-08T07:00:00.000Z'],
    // Wall time that happens twice resolves to the first occurrence.
    ['2026-10-25', '03:30', 'Europe/Kyiv', '2026-10-25T00:30:00.000Z'],
    ['2026-10-25', '02:30', 'Europe/Warsaw', '2026-10-25T00:30:00.000Z'],
    ['2026-11-01', '01:30', 'America/New_York', '2026-11-01T05:30:00.000Z'],
  ])('resolves %s %s in %s', (date, time, zone, expected) => {
    expect(iso(date, time, zone)).toBe(expected);
  });

  it('round-trips every wall time that exists', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_500 }),
        fc.integer({ min: 6, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        fc.constantFrom('Europe/Kyiv', 'Europe/Warsaw', 'America/New_York', 'Asia/Kathmandu'),
        (day, hour, minute, zone) => {
          const date = addDays('2025-01-01', day);
          const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
          const parts = toZonedParts(zonedInstant(date, time, zone), zone);
          expect([parts.date, parts.time]).toEqual([date, time]);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('refuses impossible input instead of guessing', () => {
    expect(() => zonedInstant('2026-13-01', '10:00', 'Europe/Kyiv')).toThrow(RangeError);
    expect(() => zonedInstant('2026-01-01', '10:00', 'Mars/Olympus')).toThrow(RangeError);
  });

  it('validates zones and 24-hour times', () => {
    for (const bad of ['', 'Kyiv', 'Europe/Nowhere', "Europe/Kyiv'; --"]) {
      expect(timeZoneSchema.safeParse(bad).success).toBe(false);
    }
    for (const bad of ['24:00', '9:00', '19:60', '19:00:00']) {
      expect(localTimeSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('does calendar arithmetic across month, year and leap day', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(isoWeekday('2026-03-29')).toBe(7);
    expect(isoWeekday('2026-03-30')).toBe(1);
  });
});
