import { describe, expect, it } from 'vitest';
import { apiErrorSchema, ERROR_STATUS, statusForCode } from './api-error';

describe('api error contract', () => {
  it('maps every code to a client or server error status', () => {
    for (const status of Object.values(ERROR_STATUS)) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
    expect(statusForCode('NO_SEATS')).toBe(409);
  });

  it('rejects a code that is not part of the contract', () => {
    expect(apiErrorSchema.safeParse({ code: 'OOPS', message: 'x' }).success).toBe(false);
    expect(apiErrorSchema.safeParse({ code: 'NOT_FOUND' }).success).toBe(false);
  });
});
