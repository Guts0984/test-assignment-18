import { type Redis } from 'ioredis';

/** Increment and set the expiry in one step, so a window can never be left without one. */
const SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return { count, redis.call('PTTL', KEYS[1]) }
`;

export type Limit = {
  readonly key: string;
  readonly max: number;
  readonly windowSec: number;
};

export type Verdict = { readonly allowed: boolean; readonly retryAfterSec: number };

/** A fixed window shared by every api copy. Throws when Redis cannot answer. */
export const consume = async (redis: Redis, limit: Limit): Promise<Verdict> => {
  const [count, ttlMs] = (await redis.eval(SCRIPT, 1, limit.key, limit.windowSec * 1000)) as [
    number,
    number,
  ];
  return {
    allowed: count <= limit.max,
    retryAfterSec: Math.max(1, Math.ceil(ttlMs / 1000)),
  };
};
