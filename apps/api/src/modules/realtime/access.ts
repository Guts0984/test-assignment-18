import { type Db } from '@school/db/client';
import { type Room } from '@school/shared/realtime/events';
import { type Principal } from '../../common/auth/principal';

/**
 * Who may listen to a room. The catalog is public; every other room belongs to someone: a
 * student's or mentor's own room, and a cohort's staff room for its mentor and its school's
 * managers.
 */
export const mayJoin = async (
  db: Db,
  principal: Principal | undefined,
  room: Room,
): Promise<boolean> => {
  if (room.kind === 'catalog') return true;
  if (!principal) return false;
  if (room.kind === 'user') return principal.id === room.id;
  if (room.kind === 'mentor') return principal.role === 'mentor' && principal.id === room.id;
  const { role, schoolId, id } = principal;
  if (schoolId === null || (role !== 'manager' && role !== 'mentor')) return false;
  const count = await db.cohort.count({
    where: { id: room.id, schoolId, ...(role === 'mentor' ? { mentorId: id } : {}) },
  });
  return count === 1;
};
