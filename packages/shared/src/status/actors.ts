export const STAFF_ROLES = ['admin', 'manager', 'mentor'] as const;
export const ROLES = ['student', ...STAFF_ROLES] as const;
export type Role = (typeof ROLES)[number];
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Who causes a status change. `system` is a payment notification or a background job. */
export type Actor = 'student' | 'mentor' | 'manager' | 'system';

export type Transition<S extends string> = {
  /** Null means the record is being created. */
  readonly from: S | null;
  readonly to: S;
  readonly actors: readonly Actor[];
  readonly when: string;
};

export const findTransition = <S extends string>(
  table: readonly Transition<S>[],
  from: S | null,
  to: S,
  actor: Actor,
): Transition<S> | undefined =>
  table.find((row) => row.from === from && row.to === to && row.actors.includes(actor));
