import { type Db } from '@school/db/client';
import { type Role } from '@school/shared/status/actors';
import { z } from 'zod';
import { verifyAccessToken } from './access-token';
import { type Principal } from './principal';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';

/** Reads the account on every call, so disabling someone or changing a role acts at once. */
export const authenticate = async (
  deps: { readonly db: Db; readonly secret: string },
  token: string | undefined,
): Promise<Principal | undefined> => {
  if (token === undefined) return undefined;
  const userId = await verifyAccessToken(token, deps.secret);
  if (!z.uuid().safeParse(userId).success || userId === undefined) return undefined;
  const user = await deps.db.user.findUnique({ where: { id: userId } });
  if (!user || user.disabledAt) return undefined;
  return { id: user.id, role: user.role as Role, schoolId: user.schoolId };
};
