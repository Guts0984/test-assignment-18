import { describe, expect, it } from 'vitest';
import { homeworkDeadline, isLate } from './deadline';

describe('homework deadline', () => {
  it('is the end of 23:59 cohort-local seven days later, across the spring switch', () => {
    // Lesson on Tuesday 24 March (+02:00), deadline on Tuesday 31 March (+03:00).
    expect(homeworkDeadline('2026-03-24', 'Europe/Kyiv').toISOString()).toBe(
      '2026-03-31T20:59:59.999Z',
    );
  });

  it('follows the autumn switch in New York', () => {
    expect(homeworkDeadline('2026-10-27', 'America/New_York').toISOString()).toBe(
      '2026-11-04T04:59:59.999Z',
    );
  });

  it('counts the deadline instant as on time and one millisecond later as late', () => {
    const deadline = homeworkDeadline('2026-06-01', 'Europe/Warsaw');
    expect(isLate(new Date(deadline.getTime() - 1), deadline)).toBe(false);
    expect(isLate(deadline, deadline)).toBe(false);
    expect(isLate(new Date(deadline.getTime() + 1), deadline)).toBe(true);
  });
});
