import { describe, expect, it } from 'vitest';
import { REALTIME_EVENTS, roomName, roomSchema } from './events';

const id = '018f6f1e-7b1a-7c3e-9d6a-111111111111';

describe('realtime contract', () => {
  it('names rooms by kind and id', () => {
    expect(roomName({ kind: 'catalog' })).toBe('catalog');
    expect(roomName({ kind: 'cohort-staff', id })).toBe(`cohort-staff:${id}`);
  });

  it.each([
    { kind: 'user' },
    { kind: 'user', id: '*' },
    { kind: 'admin', id },
    { kind: 'catalog', id },
  ])('rejects the join request %o', (room) => {
    expect(roomSchema.safeParse(room).success).toBe(false);
  });

  it('never publishes a negative seat count', () => {
    const schema = REALTIME_EVENTS['seats.changed'];
    expect(schema.safeParse({ cohortId: id, freeSeats: -1 }).success).toBe(false);
  });
});
