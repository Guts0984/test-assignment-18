import { createHash } from 'node:crypto';
import { type Env } from '../../config/env';
import { type Limit } from './limiter';

export type LimitScope = 'login' | 'register';

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * The windows that apply to one attempt, checked in order. The account window is per account and
 * client address, so nobody can lock another person out of their account.
 */
export const limitsFor = (
  scope: LimitScope,
  attempt: { readonly ip: string; readonly email: unknown },
  env: Env,
): readonly Limit[] => {
  if (scope === 'register') {
    return [
      {
        key: `rl:register:ip:${attempt.ip}`,
        max: env.RATE_LIMIT_REGISTER_IP_MAX,
        windowSec: env.RATE_LIMIT_REGISTER_IP_WINDOW_SEC,
      },
    ];
  }
  const byIp: Limit = {
    key: `rl:login:ip:${attempt.ip}`,
    max: env.RATE_LIMIT_LOGIN_IP_MAX,
    windowSec: env.RATE_LIMIT_LOGIN_IP_WINDOW_SEC,
  };
  if (typeof attempt.email !== 'string') return [byIp];
  const account = digest(attempt.email.trim().toLowerCase());
  return [
    byIp,
    {
      key: `rl:login:account:${account}:${attempt.ip}`,
      max: env.RATE_LIMIT_LOGIN_ACCOUNT_MAX,
      windowSec: env.RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_SEC,
    },
  ];
};
