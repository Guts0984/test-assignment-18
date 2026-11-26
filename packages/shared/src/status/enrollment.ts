import { findTransition, type Actor, type Transition } from './actors';

export const ENROLLMENT_STATUSES = [
  'held',
  'offered',
  'paid',
  'transferred',
  'cancelled',
  'refunded',
  'expired',
  'completed',
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

/** Statuses that occupy a seat. A completed cohort keeps its seats. */
export const SEAT_HOLDING_STATUSES = ['held', 'offered', 'paid', 'completed'] as const;

export const occupiesSeat = (status: EnrollmentStatus): boolean =>
  (SEAT_HOLDING_STATUSES as readonly EnrollmentStatus[]).includes(status);

export const ENROLLMENT_TRANSITIONS: readonly Transition<EnrollmentStatus>[] = [
  { from: null, to: 'held', actors: ['student', 'manager'], when: 'A free seat is booked' },
  { from: null, to: 'offered', actors: ['system'], when: 'A freed seat goes to the waitlist' },
  {
    from: null,
    to: 'paid',
    actors: ['student', 'manager'],
    when: 'Transfer with nothing left to pay',
  },
  { from: 'held', to: 'paid', actors: ['system'], when: 'Payment received, or the price is zero' },
  { from: 'held', to: 'expired', actors: ['system'], when: 'The 15-minute hold ran out' },
  {
    from: 'held',
    to: 'cancelled',
    actors: ['student', 'manager'],
    when: 'Cancelled before paying',
  },
  { from: 'offered', to: 'paid', actors: ['system'], when: 'Offer paid, or the price is zero' },
  { from: 'offered', to: 'expired', actors: ['system'], when: 'The 24-hour offer ran out' },
  { from: 'offered', to: 'cancelled', actors: ['student', 'manager'], when: 'Offer declined' },
  { from: 'expired', to: 'paid', actors: ['system'], when: 'Late payment and a seat is free' },
  {
    from: 'expired',
    to: 'refunded',
    actors: ['system'],
    when: 'Late payment that cannot be honoured',
  },
  {
    from: 'cancelled',
    to: 'refunded',
    actors: ['system'],
    when: 'Payment arrived after cancellation',
  },
  {
    from: 'paid',
    to: 'transferred',
    actors: ['student', 'manager', 'system'],
    when: 'Moved to another cohort (system: surcharge paid)',
  },
  {
    from: 'paid',
    to: 'refunded',
    actors: ['student', 'manager'],
    when: 'Cancelled or excluded with money returned',
  },
  {
    from: 'paid',
    to: 'cancelled',
    actors: ['student', 'manager'],
    when: 'Cancelled or excluded with nothing to return',
  },
  { from: 'paid', to: 'completed', actors: ['system'], when: 'The last lesson ended' },
];

export const canTransitionEnrollment = (
  from: EnrollmentStatus | null,
  to: EnrollmentStatus,
  actor: Actor,
): boolean => findTransition(ENROLLMENT_TRANSITIONS, from, to, actor) !== undefined;
