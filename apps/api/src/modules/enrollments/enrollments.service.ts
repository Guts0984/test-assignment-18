import { Inject, Injectable } from '@nestjs/common';
import { cancelEnrollment, refundPercentFor } from '@school/db/repo/cancel';
import { applyPromoToEnrollment, holdSeat } from '@school/db/repo/hold';
import { spendableBalance } from '@school/db/repo/payment-confirm';
import { transferEnrollment } from '@school/db/repo/transfer';
import { type Currency } from '@school/shared/money/money';
import { refundAmount } from '@school/shared/refund/refund';
import { type RefundPreview } from '@school/shared/schemas/enrollment';
import { apiError } from '../../common/errors/api-error';
import { messageFor, rejected } from '../../common/errors/rejections';
import { runBusiness } from '../../infra/business';
import { DEPS, type Deps } from '../../infra/deps';
import { isoDate } from '../catalog/domain';
import { findOwnEnrollments, toEnrollmentView } from './view';

@Injectable()
export class EnrollmentsService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  async list(studentId: string) {
    const [rows, now] = await Promise.all([
      findOwnEnrollments(this.deps.db, studentId),
      this.deps.time.now(),
    ]);
    return { items: rows.map((row) => toEnrollmentView(row, now)) };
  }

  async get(studentId: string, id: string) {
    const [row] = await findOwnEnrollments(this.deps.db, studentId, id);
    if (!row) throw rejected('NOT_FOUND');
    return toEnrollmentView(row, await this.deps.time.now());
  }

  async hold(studentId: string, input: { cohortId: string; promoCode?: string | undefined }) {
    const outcome = await runBusiness(this.deps, (unit) =>
      holdSeat(unit, { ...input, promoCode: input.promoCode, studentId }),
    );
    if (typeof outcome === 'string') throw rejected(outcome);
    const code = outcome.promoRejected;
    return {
      ...(await this.get(studentId, outcome.enrollmentId)),
      promoError: code === null ? null : { code, message: messageFor(code) },
    };
  }

  async applyPromo(studentId: string, id: string, code: string) {
    await this.requireOwn(studentId, id);
    const rejection = await runBusiness(this.deps, async (unit) => {
      const found = await unit.tx.enrollment.findUniqueOrThrow({ where: { id } });
      await unit.tx.$queryRaw`
        SELECT id FROM cohorts WHERE id = ${found.cohortId}::uuid FOR NO KEY UPDATE`;
      const current = await unit.tx.enrollment.findUniqueOrThrow({ where: { id } });
      const unpaid = current.status === 'held' || current.status === 'offered';
      if (!unpaid) return 'INVALID_TRANSITION' as const;
      if (current.holdExpiresAt && current.holdExpiresAt <= unit.now) {
        return 'HOLD_EXPIRED' as const;
      }
      // A transfer surcharge is a price difference, not a course price.
      if (current.transferFromId) return 'PROMO_NOT_APPLICABLE' as const;
      return applyPromoToEnrollment(unit, { enrollmentId: id, code });
    });
    if (rejection) throw rejected(rejection);
    return this.get(studentId, id);
  }

  async refundPreview(studentId: string, id: string): Promise<RefundPreview> {
    await this.requireOwn(studentId, id);
    return runBusiness(this.deps, async (unit) => {
      const enrollment = await unit.tx.enrollment.findUniqueOrThrow({
        where: { id },
        include: { cohort: true },
      });
      const unpaid = enrollment.status === 'held' || enrollment.status === 'offered';
      if (!unpaid && enrollment.status !== 'paid') throw rejected('INVALID_TRANSITION');
      const paidMinor = await spendableBalance(unit, id);
      const percent = await refundPercentFor(unit.tx, enrollment.cohort, unit.now);
      return {
        percent,
        amountMinor: refundAmount({ netPaidMinor: paidMinor, percent, policy: 'rule' }),
        currency: enrollment.currency as Currency,
        paidMinor,
      };
    });
  }

  async cancel(studentId: string, id: string) {
    await this.requireOwn(studentId, id);
    const outcome = await runBusiness(this.deps, (unit) =>
      cancelEnrollment(unit, {
        enrollmentId: id,
        actor: { kind: 'student', id: studentId },
        policy: 'rule',
      }),
    );
    if (outcome !== 'CANCELLED') throw rejected(outcome);
    return this.get(studentId, id);
  }

  async transferOptions(studentId: string, id: string) {
    await this.requireOwn(studentId, id);
    return runBusiness(this.deps, async (unit) => {
      const source = await unit.tx.enrollment.findUniqueOrThrow({
        where: { id },
        include: { cohort: true },
      });
      if (source.status !== 'paid') return { items: [] };
      const credit = await spendableBalance(unit, id);
      const cohorts = await unit.tx.cohort.findMany({
        where: {
          courseId: source.cohort.courseId,
          currency: source.currency,
          id: { not: source.cohortId },
          startsAt: { gt: unit.now },
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: 50,
      });
      const waiting = await unit.tx.waitlistEntry.groupBy({
        by: ['cohortId'],
        where: { cohortId: { in: cohorts.map((c) => c.id) }, status: 'waiting' },
        _count: true,
      });
      const waitingFor = new Map(waiting.map((row) => [row.cohortId, row._count]));
      return {
        items: cohorts.map((cohort) => ({
          cohortId: cohort.id,
          startDate: isoDate(cohort.startDate),
          startsAt: cohort.startsAt.toISOString(),
          timeZone: cohort.timeZone,
          freeSeats: Math.max(
            0,
            cohort.capacity - cohort.seatsTaken - (waitingFor.get(cohort.id) ?? 0),
          ),
          priceMinor: cohort.priceMinor,
          currency: cohort.currency as Currency,
          differenceMinor: cohort.priceMinor - credit,
        })),
      };
    });
  }

  async transfer(studentId: string, id: string, targetCohortId: string) {
    await this.requireOwn(studentId, id);
    const outcome = await runBusiness(this.deps, (unit) =>
      transferEnrollment(unit, {
        enrollmentId: id,
        targetCohortId,
        actor: { kind: 'student', id: studentId },
      }),
    );
    if (typeof outcome === 'string') throw rejected(outcome);
    return this.get(studentId, outcome.enrollmentId);
  }

  /** Another student's enrollment is indistinguishable from a missing one. */
  private async requireOwn(studentId: string, id: string): Promise<void> {
    const count = await this.deps.db.enrollment.count({ where: { id, studentId } });
    if (count === 0) throw apiError('NOT_FOUND', 'Not found');
  }
}
