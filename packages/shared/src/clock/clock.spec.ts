import { describe, expect, it } from 'vitest';
import { createFixedClock, createOffsetClock } from './clock';

describe('clocks', () => {
  it('moves only when told to', () => {
    const clock = createFixedClock(new Date('2026-01-01T00:00:00Z'));
    clock.advance(1_000);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:01.000Z');
    clock.set(new Date('2030-01-01T00:00:00Z'));
    expect(clock.now().getUTCFullYear()).toBe(2030);
  });

  it('hands out copies, so a caller cannot shift the clock by mutating a date', () => {
    const clock = createFixedClock(new Date('2026-01-01T00:00:00Z'));
    clock.now().setUTCFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it('re-reads the offset on every call', () => {
    let offset = 0;
    const base = createFixedClock(new Date('2026-01-01T00:00:00Z'));
    const shifted = createOffsetClock(base, () => offset);
    expect(shifted.now()).toEqual(base.now());
    offset = 86_400_000;
    expect(shifted.now().toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });
});
