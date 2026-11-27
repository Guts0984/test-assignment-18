import { type Db } from '@school/db/client';
import { type Role } from '@school/shared/status/actors';
import { z } from 'zod';
import { type Claims, verifyAccessToken } from './access-token';
import { type Principal } from './principal';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';

/**
 * The account behind a session that is still alive. A session ends when its refresh family is
 * revoked: on logout, on reuse of a refresh token, or when the account is disabled.
 */
export const principalOfSession = async (
  db: Db,
  claims: Claims,
): Promise<Principal | undefined> => {
  const user = await db.user.findUnique({
    where: { id: claims.userId },
    include: {
      refreshTokens: {
        where: { familyId: claims.sessionId, revokedAt: null },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!user || user.disabledAt || user.refreshTokens.length === 0) return undefined;
  return {
    id: user.id,
    role: user.role as Role,
    schoolId: user.schoolId,
    sessionId: claims.sessionId,
  };
};

/** Reads the account on every call, so ending a session or changing a role acts at once. */
export const authenticate = async (
  deps: { readonly db: Db; readonly secret: string },
  token: string | undefined,
): Promise<Principal | undefined> => {
  if (token === undefined) return undefined;
  const claims = await verifyAccessToken(token, deps.secret);
  const id = z.uuid();
  if (!claims || !id.safeParse(claims.userId).success) return undefined;
  if (!id.safeParse(claims.sessionId).success) return undefined;
  return principalOfSession(deps.db, claims);
};
