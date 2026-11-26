import { type Account } from '@school/shared/schemas/auth';
import { type Role } from '@school/shared/status/actors';

export const toAccount = (user: {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: string;
  readonly schoolId: string | null;
  readonly timeZone: string;
}): Account => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName,
  role: user.role as Role,
  schoolId: user.schoolId,
  timeZone: user.timeZone,
});
