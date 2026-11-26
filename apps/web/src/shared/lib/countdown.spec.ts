import { describe, expect, it } from 'vitest';
import { formatRemaining, remainingMs, serverOffsetMs } from './countdown';

const serverNow = '2026-03-01T10:00:00.000Z';
const deadline = '2026-03-01T10:15:00.000Z';
const server = Date.parse(serverNow);

describe('countdown by the server clock', () => {
  it.each([-600_000, 0, 600_000, 86_400_000])(
    'shows the same time left on a device skewed by %d ms',
    (skew) => {
      const device = server + skew;
      const offset = serverOffsetMs(serverNow, device);
      expect(remainingMs(deadline, offset, device)).toBe(900_000);
      expect(remainingMs(deadline, offset, device + 60_000)).toBe(840_000);
    },
  );

  it('stops at zero', () => {
    expect(remainingMs(deadline, 0, Date.parse(deadline) + 5_000)).toBe(0);
  });

  it.each([
    [900_000, '15:00'],
    [899_001, '15:00'],
    [59_000, '00:59'],
    [1, '00:01'],
    [0, '00:00'],
    [86_400_000, '24:00:00'],
    [3_600_000, '1:00:00'],
  ])('formats %d ms as %s', (ms, text) => {
    expect(formatRemaining(ms)).toBe(text);
  });
});
