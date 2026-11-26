import { isDeepStrictEqual } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import { open } from '@school/gateway/secret-box';
import { verify } from '@school/gateway/signature';
import { notificationJob } from '@school/shared/jobs/job';
import { notificationSchema } from '@school/shared/schemas/gateway-protocol';
import { apiError } from '../../common/errors/api-error';
import { DEPS, type Deps } from '../../infra/deps';

const refuse = () => apiError('INVALID_SIGNATURE', 'The signature is not valid');

@Injectable()
export class WebhookService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  /** Stores a signed notification once and hands it to the worker. */
  async receive(input: {
    readonly schoolId: string;
    readonly signature: string | undefined;
    readonly rawBody: Buffer;
  }): Promise<void> {
    const { db, env, jobs, logger, time } = this.deps;
    const config = await db.gatewayConfig.findUnique({ where: { schoolId: input.schoolId } });
    if (!config) throw refuse();
    const authentic = verify({
      key: open(config.keyCiphertext, env.GATEWAY_ENCRYPTION_KEY),
      header: input.signature,
      body: input.rawBody,
      // Signature age is measured on the wall clock, never on the movable business clock.
      now: new Date(),
      maxSkewSec: env.WEBHOOK_MAX_SKEW_SEC,
    });
    if (!authentic) throw refuse();
    const parsed = notificationSchema.safeParse(JSON.parse(input.rawBody.toString('utf8')));
    if (!parsed.success) throw apiError('VALIDATION_FAILED', 'Unknown notification format');
    const event = parsed.data;
    const identity = { schoolId: event.schoolId, providerEventId: event.eventId };
    await db.paymentNotification.createMany({
      data: [{ ...identity, kind: event.type, payload: event, receivedAt: await time.now() }],
      skipDuplicates: true,
    });
    const stored = await db.paymentNotification.findUniqueOrThrow({
      where: { schoolId_providerEventId: identity },
    });
    if (!isDeepStrictEqual(stored.payload, event)) {
      logger.warn({ notificationId: stored.id }, 'an event id arrived again with other content');
    }
    if (!stored.processedAt) await jobs.publish([notificationJob(stored.id)]);
  }
}
