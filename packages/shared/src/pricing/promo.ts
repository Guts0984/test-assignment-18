import { z } from 'zod';
import { amountMinorSchema, currencySchema, percentOf, type Currency } from '../money/money';
import { err, ok, type Result } from '../result/result';

export const discountSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('percent'), percent: z.number().int().min(1).max(100) }),
  z.strictObject({
    kind: z.literal('fixed'),
    amountMinor: amountMinorSchema.min(1),
    currency: currencySchema,
  }),
]);
export type Discount = z.infer<typeof discountSchema>;

export type PromoTerms = {
  readonly schoolId: string;
  readonly courseId: string | null;
  readonly discount: Discount;
  readonly validFrom: Date;
  /** Exclusive. */
  readonly validUntil: Date;
  readonly maxUses: number;
  readonly usedCount: number;
  readonly reservedCount: number;
};

export type PromoTarget = {
  readonly schoolId: string;
  readonly courseId: string;
  readonly currency: Currency;
  readonly priceMinor: number;
};

export type PromoRejection =
  | 'PROMO_NOT_APPLICABLE'
  | 'PROMO_NOT_STARTED'
  | 'PROMO_EXPIRED'
  | 'PROMO_EXHAUSTED'
  | 'PROMO_CURRENCY_MISMATCH';

export const discountedPrice = (
  priceMinor: number,
  currency: Currency,
  discount: Discount,
): Result<number, 'PROMO_CURRENCY_MISMATCH'> => {
  if (discount.kind === 'percent') {
    return ok(priceMinor - percentOf(priceMinor, discount.percent));
  }
  if (discount.currency !== currency) return err('PROMO_CURRENCY_MISMATCH');
  return ok(Math.max(0, priceMinor - discount.amountMinor));
};

/** Whether a promo can be reserved for a target now, and the resulting price. */
export const evaluatePromo = (
  promo: PromoTerms,
  target: PromoTarget,
  now: Date,
): Result<number, PromoRejection> => {
  const otherSchool = promo.schoolId !== target.schoolId;
  const otherCourse = promo.courseId !== null && promo.courseId !== target.courseId;
  if (otherSchool || otherCourse) return err('PROMO_NOT_APPLICABLE');
  if (now < promo.validFrom) return err('PROMO_NOT_STARTED');
  if (now >= promo.validUntil) return err('PROMO_EXPIRED');
  const price = discountedPrice(target.priceMinor, target.currency, promo.discount);
  if (!price.ok) return price;
  if (promo.usedCount + promo.reservedCount >= promo.maxUses) return err('PROMO_EXHAUSTED');
  return price;
};
