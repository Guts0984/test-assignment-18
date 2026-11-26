import { type StubEnv } from './config/env';

export type Chaos = {
  readonly enabled: boolean;
  readonly apiTargets: readonly string[];
  readonly lateProbability: number;
  readonly lateDelaySec: number;
  readonly earlyRefundProbability: number;
  readonly refundFailEvery: number;
};

export const chaosFrom = (env: StubEnv): Chaos => ({
  enabled: env.PAYSTUB_CHAOS_MODE,
  apiTargets: env.PAYSTUB_CHAOS_API_TARGETS,
  lateProbability: env.PAYSTUB_CHAOS_LATE_PROBABILITY,
  lateDelaySec: env.PAYSTUB_CHAOS_LATE_DELAY_SEC,
  earlyRefundProbability: env.PAYSTUB_CHAOS_EARLY_REFUND_PROBABILITY,
  refundFailEvery: env.PAYSTUB_CHAOS_REFUND_FAIL_EVERY,
});

export type PaymentPlan = {
  /** One entry per copy to send; each is sent at the same moment. */
  readonly targets: readonly string[];
  readonly delaySec: number;
};

/** The callback address as seen by each api copy: same path, that copy's origin. */
export const retarget = (callbackUrl: string, origin: string): string => {
  const callback = new URL(callbackUrl);
  return new URL(`${callback.pathname}${callback.search}`, origin).toString();
};

/** In chaos mode a payment is announced twice, to both api copies, and sometimes late. */
export const planPaymentDelivery = (
  chaos: Chaos,
  callbackUrl: string,
  random: () => number,
): PaymentPlan => {
  if (!chaos.enabled) return { targets: [callbackUrl], delaySec: 0 };
  const [first, second] = chaos.apiTargets.map((origin) => retarget(callbackUrl, origin));
  const targets = [first ?? callbackUrl, second ?? first ?? callbackUrl];
  const late = random() < chaos.lateProbability;
  return { targets, delaySec: late ? chaos.lateDelaySec : 0 };
};

export type RefundFault = 'none' | 'error' | 'timeout';

/**
 * Every Nth refund call fails, alternating between a 500 answer and no answer at all.
 * `attempt` counts calls from 1.
 */
export const refundFault = (chaos: Chaos, attempt: number): RefundFault => {
  if (!chaos.enabled || attempt % chaos.refundFailEvery !== 0) return 'none';
  return (attempt / chaos.refundFailEvery) % 2 === 1 ? 'error' : 'timeout';
};

export const notifiesBeforeAnswering = (chaos: Chaos, random: () => number): boolean =>
  chaos.enabled && random() < chaos.earlyRefundProbability;

/** Exponential backoff capped at a minute. */
export const retryDelayMs = (baseMs: number, attempt: number): number =>
  Math.min(60_000, baseMs * 2 ** Math.max(0, attempt - 1));
