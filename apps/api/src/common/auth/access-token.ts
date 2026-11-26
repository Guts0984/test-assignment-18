import { jwtVerify, SignJWT } from 'jose';

const ALGORITHM = 'HS256';
const ISSUER = 'school-api';

const keyOf = (secret: string): Uint8Array => new TextEncoder().encode(secret);

export const signAccessToken = (
  userId: string,
  options: { readonly secret: string; readonly ttlSec: number; readonly now: Date },
): Promise<string> => {
  const issued = Math.floor(options.now.getTime() / 1000);
  return new SignJWT()
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuer(ISSUER)
    .setSubject(userId)
    .setIssuedAt(issued)
    .setExpirationTime(issued + options.ttlSec)
    .sign(keyOf(options.secret));
};

/** The user id of a valid, unexpired token signed by us with the expected algorithm. */
export const verifyAccessToken = async (
  token: string,
  secret: string,
): Promise<string | undefined> => {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      requiredClaims: ['sub', 'exp'],
    });
    return payload.sub;
  } catch {
    return undefined;
  }
};
