import { Inject, Injectable } from '@nestjs/common';
import { createSession } from '@school/gateway/client';
import { open } from '@school/gateway/secret-box';
import { type Currency } from '@school/shared/money/money';
import { rejected } from '../../common/errors/rejections';
import { DEPS, type Deps } from '../../infra/deps';

@Injectable()
export class CheckoutService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  /** The payment page for an unpaid enrollment; the same one for the same price. */
  async checkout(studentId: string, id: string): Promise<{ payUrl: string }> {
    const { db, env, logger, time } = this.deps;
    const enrollment = await db.enrollment.findFirst({
      where: { id, studentId },
      include: { cohort: { include: { course: true } } },
    });
    if (!enrollment) throw rejected('NOT_FOUND');
    const now = await time.now();
    const unpaid = enrollment.status === 'held' || enrollment.status === 'offered';
    if (!unpaid || enrollment.priceMinor === 0) throw rejected('INVALID_TRANSITION');
    if (!enrollment.holdExpiresAt || enrollment.holdExpiresAt <= now) {
      throw rejected('HOLD_EXPIRED');
    }
    const key = { enrollmentId: id, amountMinor: enrollment.priceMinor };
    const existing = await db.paymentSession.findUnique({
      where: { enrollmentId_amountMinor: key },
    });
    if (existing) return { payUrl: existing.payUrl };
    const { schoolId } = enrollment.cohort;
    const config = await db.gatewayConfig.findUnique({ where: { schoolId } });
    if (!config) throw rejected('GATEWAY_NOT_CONFIGURED');
    const session = await createSession(
      {
        baseUrl: config.baseUrl,
        key: open(config.keyCiphertext, env.GATEWAY_ENCRYPTION_KEY),
        timeoutMs: env.PAYSTUB_HTTP_TIMEOUT_MS,
      },
      {
        schoolId,
        orderId: id,
        amountMinor: enrollment.priceMinor,
        currency: enrollment.currency as Currency,
        description: enrollment.cohort.course.title.slice(0, 200),
        returnUrl: `${env.PUBLIC_BASE_URL}/account/enrollments/${id}`,
        callbackUrl: env.WEBHOOK_CALLBACK_URL,
      },
    );
    if (!session.ok) {
      logger.warn({ failure: session.error }, 'payment session could not be created');
      throw rejected('GATEWAY_UNAVAILABLE');
    }
    await db.paymentSession.createMany({
      data: [
        {
          ...key,
          providerSessionId: session.value.sessionId,
          payUrl: session.value.payUrl,
          createdAt: now,
        },
      ],
      skipDuplicates: true,
    });
    const stored = await db.paymentSession.findUniqueOrThrow({
      where: { enrollmentId_amountMinor: key },
    });
    return { payUrl: stored.payUrl };
  }
}
