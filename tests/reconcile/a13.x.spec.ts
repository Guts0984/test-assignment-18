import { afterAll, describe, expect, it } from 'vitest';
import * as stack from '../support/stack';

afterAll(stack.disconnect);

describe('acceptance: reconciliation', () => {
  it('A-13 seat journal equals counters and operations equal balances, for every cohort and enrollment', async () => {
    // Let background work from the earlier checks settle first.
    await stack.until(
      async () =>
        (await stack.db().paymentNotification.count({ where: { processedAt: null } })) === 0 &&
        (await stack.db().refundRequest.count({ where: { status: 'pending' } })) === 0,
      'background work to settle',
      150_000,
    );
    expect(await stack.violations()).toEqual([]);
    // The whole database was checked, seeded cohorts included.
    expect(await stack.db().cohort.count()).toBeGreaterThan(20);
  });
});
