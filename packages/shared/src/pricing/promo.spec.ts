import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  discountedPrice,
  discountSchema,
  evaluatePromo,
  type PromoTarget,
  type PromoTerms,
} from './promo';

const terms: PromoTerms = {
  schoolId: 'school-a',
  courseId: null,
  discount: { kind: 'percent', percent: 25 },
  validFrom: new Date('2026-05-01T00:00:00Z'),
  validUntil: new Date('2026-06-01T00:00:00Z'),
  maxUses: 10,
  usedCount: 0,
  reservedCount: 0,
};
const target: PromoTarget = {
  schoolId: 'school-a',
  courseId: 'course-1',
  currency: 'UAH',
  priceMinor: 10_001,
};
const during = new Date('2026-05-15T00:00:00Z');
const evaluate = (promo: Partial<PromoTerms> = {}, on: Partial<PromoTarget> = {}, now = during) =>
  evaluatePromo({ ...terms, ...promo }, { ...target, ...on }, now);

describe('promo evaluation', () => {
  it('rounds the discount down, so the price rounds up', () => {
    expect(evaluate()).toEqual({ ok: true, value: 7_501 });
  });

  it('is valid from the first instant and invalid from the end instant', () => {
    const at = (iso: string) => evaluate({}, {}, new Date(iso));
    expect(at('2026-04-30T23:59:59.999Z')).toEqual({ ok: false, error: 'PROMO_NOT_STARTED' });
    expect(at('2026-05-01T00:00:00.000Z').ok).toBe(true);
    expect(at('2026-05-31T23:59:59.999Z').ok).toBe(true);
    expect(at('2026-06-01T00:00:00.000Z')).toEqual({ ok: false, error: 'PROMO_EXPIRED' });
  });

  it('counts reservations together with uses', () => {
    expect(evaluate({ usedCount: 4, reservedCount: 5 }).ok).toBe(true);
    expect(evaluate({ usedCount: 4, reservedCount: 6 })).toEqual({
      ok: false,
      error: 'PROMO_EXHAUSTED',
    });
    expect(evaluate({ usedCount: 10 }).ok).toBe(false);
  });

  it('is limited to its school, course and currency', () => {
    const fixed = { kind: 'fixed', amountMinor: 500, currency: 'EUR' } as const;
    expect(evaluate({}, { schoolId: 'school-b' })).toEqual({
      ok: false,
      error: 'PROMO_NOT_APPLICABLE',
    });
    expect(evaluate({ courseId: 'course-2' })).toEqual({
      ok: false,
      error: 'PROMO_NOT_APPLICABLE',
    });
    expect(evaluate({ courseId: 'course-1' }).ok).toBe(true);
    expect(evaluate({ discount: fixed })).toEqual({ ok: false, error: 'PROMO_CURRENCY_MISMATCH' });
    expect(evaluate({ discount: fixed }, { currency: 'EUR' })).toEqual({ ok: true, value: 9_501 });
  });

  it('never produces a negative or increased price', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.oneof(
          fc.record({
            kind: fc.constant('percent' as const),
            percent: fc.integer({ min: 1, max: 100 }),
          }),
          fc.record({
            kind: fc.constant('fixed' as const),
            amountMinor: fc.integer({ min: 1, max: 1_000_000_000 }),
            currency: fc.constant('USD' as const),
          }),
        ),
        (price, discount) => {
          const result = discountedPrice(price, 'USD', discount);
          expect(result.ok && result.value >= 0 && result.value <= price).toBe(true);
        },
      ),
    );
  });

  it.each([
    { kind: 'percent', percent: 0 },
    { kind: 'percent', percent: 101 },
    { kind: 'percent', percent: 12.5 },
    { kind: 'fixed', amountMinor: 0, currency: 'USD' },
    { kind: 'fixed', amountMinor: 10, currency: 'GBP' },
    { kind: 'percent', percent: 10, usedCount: 0 },
  ])('rejects the discount %o', (discount) => {
    expect(discountSchema.safeParse(discount).success).toBe(false);
  });
});
