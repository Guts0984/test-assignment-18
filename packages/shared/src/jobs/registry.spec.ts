import { describe, expect, it } from 'vitest';
import { jobId, QUEUE_NAMES, QUEUES } from './registry';

const id = '018f6f1e-7b1a-7c3e-9d6a-111111111111';

describe('job registry', () => {
  it('covers every background task in the assignment', () => {
    expect([...QUEUE_NAMES].sort()).toEqual(
      [
        'certificates',
        'deadline-reminders',
        'emails',
        'hold-expiry',
        'lesson-reminders',
        'payment-notifications',
        'refunds',
        'waitlist-offers',
      ].sort(),
    );
  });

  it('rejects payloads with a bad id or extra fields', () => {
    const schema = QUEUES.refunds.payload;
    expect(schema.safeParse({ refundRequestId: id }).success).toBe(true);
    expect(schema.safeParse({ refundRequestId: '1' }).success).toBe(false);
    expect(schema.safeParse({ refundRequestId: id, amount: 1 }).success).toBe(false);
  });

  it('builds stable ids without the separator BullMQ forbids', () => {
    const first = jobId('hold-expiry', id, '2026-01-01T10:00:00Z');
    expect(first).toBe(jobId('hold-expiry', id, '2026-01-01T10:00:00Z'));
    expect(first).not.toContain(':');
    expect(first).not.toBe(jobId('hold-expiry', id, '2026-01-01T10:15:00Z'));
  });
});
