import { type CookieOptions, type Response } from 'express';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../../common/auth/session';
import { type Env } from '../../config/env';

const REFRESH_PATH = '/api/auth';

const options = (env: Env, path: string, maxAgeSec: number): CookieOptions => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax',
  path,
  maxAge: maxAgeSec * 1000,
});

export const setSessionCookies = (
  response: Response,
  env: Env,
  tokens: { readonly accessToken: string; readonly refreshToken: string },
): void => {
  response.cookie(ACCESS_COOKIE, tokens.accessToken, options(env, '/', env.JWT_ACCESS_TTL_SEC));
  response.cookie(
    REFRESH_COOKIE,
    tokens.refreshToken,
    options(env, REFRESH_PATH, env.REFRESH_TTL_SEC),
  );
};

export const clearSessionCookies = (response: Response, env: Env): void => {
  response.clearCookie(ACCESS_COOKIE, options(env, '/', 0));
  response.clearCookie(REFRESH_COOKIE, options(env, REFRESH_PATH, 0));
};
