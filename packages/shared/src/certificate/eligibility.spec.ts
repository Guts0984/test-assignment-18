import { describe, expect, it } from 'vitest';
import { isCertificateEligible, meetsHomeworkThreshold } from './eligibility';

describe('certificate eligibility', () => {
  it.each([
    [79, 100, false],
    [80, 100, true],
    [9, 12, false],
    [10, 12, true],
    [4, 5, true],
    [3, 4, false],
    [0, 0, false],
  ])('%d of %d accepted → %s', (accepted, total, expected) => {
    expect(meetsHomeworkThreshold(accepted, total)).toBe(expected);
  });

  const end = new Date('2026-05-01T18:30:00Z');
  const progress = { acceptedCount: 12, homeworkCount: 12, lastLessonEndsAt: end };

  it('waits for the last lesson to end', () => {
    expect(isCertificateEligible(progress, new Date(end.getTime() - 1))).toBe(false);
    expect(isCertificateEligible(progress, end)).toBe(true);
  });

  it('is never granted for a cohort without lessons', () => {
    expect(isCertificateEligible({ ...progress, lastLessonEndsAt: null }, end)).toBe(false);
  });
});
