import { type Role } from '@school/shared/status/actors';
import { apiError } from '../errors/api-error';

export type Principal = {
  readonly id: string;
  readonly role: Role;
  /** Null for students. */
  readonly schoolId: string | null;
};

/** The school every staff query is scoped to. */
export const schoolOf = (principal: Principal): string => {
  if (principal.schoolId === null) throw apiError('FORBIDDEN', 'Staff only');
  return principal.schoolId;
};
