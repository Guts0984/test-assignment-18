import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { amountMinorSchema, formatMoney, MAX_PRICE_MINOR, percentOf } from './money';

describe('amounts in minor units', () => {
  it.each([-1, 0.5, 100.01, Number.NaN, Infinity, MAX_PRICE_MINOR + 1, '100', null])(
    'rejects %s',
    (value) => {
      expect(amountMinorSchema.safeParse(value).success).toBe(false);
    },
  );

  it('rounds a percentage down and never exceeds the amount', () => {
    expect(percentOf(999, 50)).toBe(499);
    expect(percentOf(1, 99)).toBe(0);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_PRICE_MINOR }),
        fc.integer({ min: 0, max: 100 }),
        (amount, percent) => {
          const part = percentOf(amount, percent);
          expect(Number.isInteger(part)).toBe(true);
          expect(part).toBeGreaterThanOrEqual(0);
          expect(part).toBeLessThanOrEqual(amount);
          // Exact integer arithmetic, so floating point cannot shift the result.
          expect(BigInt(part)).toBe((BigInt(amount) * BigInt(percent)) / 100n);
        },
      ),
    );
  });

  it('formats minor units as a currency amount', () => {
    expect(formatMoney(123456, 'EUR')).toBe('€1,234.56');
  });
});
