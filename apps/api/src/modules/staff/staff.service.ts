import { Inject, Injectable } from '@nestjs/common';
import { type Tx } from '@school/db/client';
import { isUniqueViolation } from '@school/db/errors';
import { hashPassword } from '@school/db/password';
import { inTransaction } from '@school/db/transaction';
import {
  type CreateStaffInput,
  type StaffMember,
  type UpdateStaffInput,
} from '@school/shared/schemas/staff';
import { type StaffRole } from '@school/shared/status/actors';
import { apiError } from '../../common/errors/api-error';
import { DEPS, type Deps } from '../../infra/deps';

const toMember = (user: {
  id: string;
  email: string;
  fullName: string;
  role: string;
  disabledAt: Date | null;
}): StaffMember => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName,
  role: user.role as StaffRole,
  disabled: user.disabledAt !== null,
});

@Injectable()
export class StaffService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  async list(schoolId: string) {
    const users = await this.deps.db.user.findMany({
      where: { schoolId },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    });
    return { items: users.map(toMember) };
  }

  async create(schoolId: string, input: CreateStaffInput) {
    const { password, ...profile } = input;
    const passwordHash = await hashPassword(password);
    try {
      return toMember(
        await this.deps.db.user.create({ data: { ...profile, passwordHash, schoolId } }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw apiError('EMAIL_TAKEN', 'This e-mail is already used');
      throw error;
    }
  }

  async update(schoolId: string, id: string, change: UpdateStaffInput) {
    const now = await this.deps.time.now();
    return inTransaction(this.deps.db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
      const user = await tx.user.findFirst({ where: { id, schoolId } });
      if (!user) throw apiError('NOT_FOUND', 'No such employee');
      if (user.role === 'admin') {
        throw apiError('FORBIDDEN', 'Administrators are not managed here');
      }
      const leavesMentoring =
        user.role === 'mentor' && (change.disabled === true || change.role === 'manager');
      if (leavesMentoring) await this.requireNoOpenCohorts(tx, id, now);
      const updated = await tx.user.update({
        where: { id },
        data: {
          ...(change.fullName === undefined ? {} : { fullName: change.fullName }),
          ...(change.role === undefined ? {} : { role: change.role }),
          ...(change.disabled === undefined ? {} : { disabledAt: change.disabled ? now : null }),
        },
      });
      if (change.disabled === true) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      return toMember(updated);
    });
  }

  private async requireNoOpenCohorts(tx: Tx, mentorId: string, now: Date): Promise<void> {
    const open = await tx.cohort.count({ where: { mentorId, endsAt: { gt: now } } });
    if (open > 0) {
      throw apiError('CONFLICT', 'Reassign the cohorts of this mentor first');
    }
  }
}
