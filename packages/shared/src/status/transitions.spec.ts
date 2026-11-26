import { describe, expect, it } from 'vitest';
import { type Actor } from './actors';
import {
  canTransitionEnrollment,
  ENROLLMENT_STATUSES,
  ENROLLMENT_TRANSITIONS,
  occupiesSeat,
} from './enrollment';
import { canTransitionSubmission, SUBMISSION_STATUSES, SUBMISSION_TRANSITIONS } from './submission';

const ACTORS: readonly Actor[] = ['student', 'mentor', 'manager', 'system'];

const allowed = <S extends string>(
  statuses: readonly S[],
  can: (from: S | null, to: S, actor: Actor) => boolean,
) =>
  [null, ...statuses].flatMap((from) =>
    statuses.flatMap((to) =>
      ACTORS.filter((actor) => can(from, to, actor)).map(
        (actor) => `${from ?? '-'}>${to}:${actor}`,
      ),
    ),
  );

describe('enrollment transitions', () => {
  // The whole matrix is pinned: any new permission has to be added here on purpose.
  it('allows exactly these', () => {
    expect(allowed(ENROLLMENT_STATUSES, canTransitionEnrollment).sort()).toEqual(
      [
        '->held:student',
        '->held:manager',
        '->offered:system',
        '->paid:student',
        '->paid:manager',
        'held>paid:system',
        'held>expired:system',
        'held>cancelled:student',
        'held>cancelled:manager',
        'offered>paid:system',
        'offered>expired:system',
        'offered>cancelled:student',
        'offered>cancelled:manager',
        'expired>paid:system',
        'expired>refunded:system',
        'cancelled>refunded:system',
        'paid>transferred:student',
        'paid>transferred:manager',
        'paid>transferred:system',
        'paid>refunded:student',
        'paid>refunded:manager',
        'paid>cancelled:student',
        'paid>cancelled:manager',
        'paid>completed:system',
      ].sort(),
    );
  });

  it('never lets a mentor touch an enrollment, and ends at transferred, refunded and completed', () => {
    expect(ENROLLMENT_TRANSITIONS.some((row) => row.actors.includes('mentor'))).toBe(false);
    for (const final of ['transferred', 'refunded', 'completed']) {
      expect(ENROLLMENT_TRANSITIONS.some((row) => row.from === final)).toBe(false);
    }
  });

  it('counts seats for held, offered, paid and completed only', () => {
    expect(ENROLLMENT_STATUSES.filter(occupiesSeat)).toEqual([
      'held',
      'offered',
      'paid',
      'completed',
    ]);
  });
});

describe('submission transitions', () => {
  it('allows exactly these', () => {
    expect(allowed(SUBMISSION_STATUSES, canTransitionSubmission).sort()).toEqual(
      [
        '->submitted:student',
        'submitted>submitted:student',
        'returned>submitted:student',
        'submitted>in_review:mentor',
        'in_review>submitted:mentor',
        'in_review>accepted:mentor',
        'in_review>returned:mentor',
      ].sort(),
    );
  });

  it('treats accepted work as final', () => {
    expect(SUBMISSION_TRANSITIONS.some((row) => row.from === 'accepted')).toBe(false);
  });
});
