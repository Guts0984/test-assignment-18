import { type Cohort } from '@prisma/client';
import {
  cappedPercent,
  refundBoundaries,
  refundPercent,
  type RefundPercent,
} from '@school/shared/refund/refund';
import { type Tx } from '../client';

export const refundPercentFor = async (
  tx: Tx,
  cohort: Cohort,
  at: Date,
): Promise<RefundPercent> => {
  const lessons = await tx.lesson.findMany({ where: { cohortId: cohort.id } });
  return refundPercent(
    at,
    refundBoundaries({
      lessons,
      startDate: cohort.startDate.toISOString().slice(0, 10),
      timeZone: cohort.timeZone,
    }),
  );
};

/** What a cancellation of this enrollment returns now: the cohort's rule, within its cap. */
export const refundPercentOf = async (
  tx: Tx,
  enrollment: { readonly refundCapPercent: number },
  cohort: Cohort,
  at: Date,
): Promise<RefundPercent> =>
  cappedPercent(
    await refundPercentFor(tx, cohort, at),
    enrollment.refundCapPercent as RefundPercent,
  );
