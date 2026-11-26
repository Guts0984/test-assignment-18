import { findTransition, type Actor, type Transition } from './actors';

export const SUBMISSION_STATUSES = ['submitted', 'in_review', 'accepted', 'returned'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const SUBMISSION_TRANSITIONS: readonly Transition<SubmissionStatus>[] = [
  { from: null, to: 'submitted', actors: ['student'], when: 'First submission' },
  {
    from: 'submitted',
    to: 'submitted',
    actors: ['student'],
    when: 'Replaced before a mentor takes it',
  },
  { from: 'returned', to: 'submitted', actors: ['student'], when: 'Resubmitted after remarks' },
  { from: 'submitted', to: 'in_review', actors: ['mentor'], when: 'A mentor takes it' },
  { from: 'in_review', to: 'submitted', actors: ['mentor'], when: 'The reviewer releases it' },
  { from: 'in_review', to: 'accepted', actors: ['mentor'], when: 'The reviewer accepts it' },
  { from: 'in_review', to: 'returned', actors: ['mentor'], when: 'The reviewer returns it' },
];

export const canTransitionSubmission = (
  from: SubmissionStatus | null,
  to: SubmissionStatus,
  actor: Actor,
): boolean => findTransition(SUBMISSION_TRANSITIONS, from, to, actor) !== undefined;
