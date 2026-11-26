import { type Cohort, type Enrollment, type PromoCode } from '@prisma/client';
import { type Currency } from '@school/shared/money/money';
import { evaluatePromo, type Discount, type PromoRejection } from '@school/shared/pricing/promo';
import { type Unit } from './context';

export const discountOf = (promo: PromoCode): Discount =>
  promo.discountKind === 'percent'
    ? { kind: 'percent', percent: promo.percent ?? 0 }
    : {
        kind: 'fixed',
        amountMinor: promo.amountMinor ?? 0,
        currency: promo.currency as Currency,
      };

const lockPromo = async (unit: Unit, id: string): Promise<PromoCode> => {
  await unit.tx.$queryRaw`SELECT id FROM promo_codes WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
  return unit.tx.promoCode.findUniqueOrThrow({ where: { id } });
};

export type ApplyRejection = PromoRejection | 'PROMO_NOT_FOUND' | 'PROMO_ALREADY_APPLIED';

/**
 * Reserves one use of a code for an unpaid enrollment and lowers its price. Returns the new
 * price. The reservation counts against the limit until the enrollment is paid or released.
 */
export const reservePromo = async (
  unit: Unit,
  input: { readonly enrollment: Enrollment; readonly cohort: Cohort; readonly code: string },
): Promise<{ readonly priceMinor: number } | ApplyRejection> => {
  const { enrollment, cohort } = input;
  const existing = await unit.tx.promoRedemption.findUnique({
    where: { enrollmentId: enrollment.id },
  });
  if (existing && existing.state !== 'released') return 'PROMO_ALREADY_APPLIED';
  const found = await unit.tx.promoCode.findUnique({
    where: { schoolId_code: { schoolId: cohort.schoolId, code: input.code } },
  });
  if (!found) return 'PROMO_NOT_FOUND';
  const promo = await lockPromo(unit, found.id);
  const price = evaluatePromo(
    {
      schoolId: promo.schoolId,
      courseId: promo.courseId,
      discount: discountOf(promo),
      validFrom: promo.validFrom,
      validUntil: promo.validUntil,
      maxUses: promo.maxUses,
      usedCount: promo.usedCount,
      reservedCount: promo.reservedCount,
    },
    {
      schoolId: cohort.schoolId,
      courseId: cohort.courseId,
      currency: enrollment.currency as Currency,
      priceMinor: enrollment.priceMinor,
    },
    unit.now,
  );
  if (!price.ok) return price.error;
  const data = {
    promoId: promo.id,
    state: 'reserved',
    discountMinor: enrollment.priceMinor - price.value,
    updatedAt: unit.now,
  };
  await unit.tx.promoRedemption.upsert({
    where: { enrollmentId: enrollment.id },
    create: { enrollmentId: enrollment.id, ...data },
    update: data,
  });
  await unit.tx.enrollment.update({
    where: { id: enrollment.id },
    data: { priceMinor: price.value, updatedAt: unit.now },
  });
  return { priceMinor: price.value };
};

export const consumePromo = async (unit: Unit, enrollmentId: string): Promise<void> => {
  await unit.tx.promoRedemption.updateMany({
    where: { enrollmentId, state: 'reserved' },
    data: { state: 'used', updatedAt: unit.now },
  });
};

/** An unpaid enrollment that ends gives its reservation back. */
export const releasePromo = async (unit: Unit, enrollmentId: string): Promise<void> => {
  await unit.tx.promoRedemption.updateMany({
    where: { enrollmentId, state: 'reserved' },
    data: { state: 'released', updatedAt: unit.now },
  });
};

/** For a late payment: takes a use again, if one is left. True when no promo was involved. */
export const reacquirePromo = async (unit: Unit, enrollmentId: string): Promise<boolean> => {
  const redemption = await unit.tx.promoRedemption.findUnique({ where: { enrollmentId } });
  if (!redemption) return true;
  if (redemption.state !== 'released') return true;
  const promo = await lockPromo(unit, redemption.promoId);
  if (promo.usedCount + promo.reservedCount >= promo.maxUses) return false;
  await unit.tx.promoRedemption.update({
    where: { enrollmentId },
    data: { state: 'reserved', updatedAt: unit.now },
  });
  return true;
};
