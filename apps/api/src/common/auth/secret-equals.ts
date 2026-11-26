import { createHash, timingSafeEqual } from 'node:crypto';

/** Compares secrets in constant time, whatever their lengths. */
export const secretEquals = (presented: string, expected: string): boolean => {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(presented), digest(expected));
};
