import { describe, expect, it } from 'vitest';
import {
  notifiesBeforeAnswering,
  planPaymentDelivery,
  refundFault,
  retryDelayMs,
  type Chaos,
} from './chaos';

const chaos: Chaos = {
  enabled: true,
  apiTargets: ['http://api-1:3000', 'http://api-2:3000'],
  lateProbability: 0.2,
  lateDelaySec: 1200,
  earlyRefundProbability: 0.5,
  refundFailEvery: 5,
};
const callback = 'http://nginx/api/payments/webhook';

describe('chaos mode', () => {
  it('announces a payment to both api copies at once', () => {
    expect(planPaymentDelivery(chaos, callback, () => 0.9)).toEqual({
      targets: ['http://api-1:3000/api/payments/webhook', 'http://api-2:3000/api/payments/webhook'],
      delaySec: 0,
    });
  });

  it('delays some payments by twenty minutes', () => {
    expect(planPaymentDelivery(chaos, callback, () => 0.1).delaySec).toBe(1200);
    expect(planPaymentDelivery(chaos, callback, () => 0.2).delaySec).toBe(0);
  });

  it('fails every fifth refund call, with errors and timeouts in turn', () => {
    const faults = Array.from({ length: 20 }, (_, i) => refundFault(chaos, i + 1));
    expect(faults.map((f, i) => (f === 'none' ? null : `${i + 1}:${f}`)).filter(Boolean)).toEqual([
      '5:error',
      '10:timeout',
      '15:error',
      '20:timeout',
    ]);
  });

  it('changes nothing when switched off', () => {
    const off = { ...chaos, enabled: false };
    expect(planPaymentDelivery(off, callback, () => 0)).toEqual({
      targets: [callback],
      delaySec: 0,
    });
    expect(refundFault(off, 5)).toBe('none');
    expect(notifiesBeforeAnswering(off, () => 0)).toBe(false);
  });

  it('backs off between redeliveries, up to a minute', () => {
    expect([1, 2, 3].map((n) => retryDelayMs(1000, n))).toEqual([1000, 2000, 4000]);
    expect(retryDelayMs(1000, 30)).toBe(60_000);
  });
});
