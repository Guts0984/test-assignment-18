import { describe, expect, it } from 'vitest';
import { retryDelayMs } from './retry-delay';

describe('retryDelayMs', () => {
  it('starts short, doubles, and never exceeds half a minute', () => {
    expect([0, 1, 2, 3].map(retryDelayMs)).toEqual([500, 1_000, 2_000, 4_000]);
    expect([6, 10, 5_000].map(retryDelayMs)).toEqual([30_000, 30_000, 30_000]);
  });
});
