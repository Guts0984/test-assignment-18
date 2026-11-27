import { jwtVerify, SignJWT } from 'jose';

const ALGORITHM = 'HS256';
const ISSUER = 'school-api';

const keyOf = (secret: string): Uint8Array => new TextEncoder().encode(secret);

export type Claims = {
  readonly userId: string;
  /** The refresh token family the access token belongs to. */
  readonly sessionId: string;
};

export const signAccessToken = (
  claims: Claims,
  options: { readonly secret: string; readonly ttlSec: number; readonly now: Date },
): Promise<string> => {
  const issued = Math.floor(options.now.getTime() / 1000);
  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setSubject(claims.userId)
    .setIssuedAt(issued)
    .setExpirationTime(issued + options.ttlSec)
    .sign(keyOf(options.secret));
};

/** The claims of a valid, unexpired token signed by us with the expected algorithm. */
export const verifyAccessToken = async (
  token: string,
  secret: string,
): Promise<Claims | undefined> => {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      requiredClaims: ['sub', 'exp', 'sid'],
    });
    const { sub: userId, sid: sessionId } = payload;
    return userId !== undefined && typeof sessionId === 'string'
      ? { userId, sessionId }
      : undefined;
  } catch {
    return undefined;
  }
};
