import { describe, expect, it } from 'vitest';
import { reportFromUrl, share } from './period';

const now = new Date('2026-11-26T15:00:00Z');

describe('report address', () => {
  it('defaults to the last twelve months', () => {
    expect(reportFromUrl({}, now)).toEqual({
      query: { from: '2025-11-27', to: '2026-11-26' },
    });
  });

  it('keeps the filters of the address', () => {
    const result = reportFromUrl({ from: '2026-01-01', currency: 'EUR' }, now);
    expect(result).toEqual({ query: { from: '2026-01-01', to: '2026-11-26', currency: 'EUR' } });
  });

  it('explains a bad address instead of sending it', () => {
    expect(reportFromUrl({ from: '2027-01-01' }, now)).toHaveProperty('problem');
    expect(reportFromUrl({ currency: 'BTC' }, now)).toHaveProperty('problem');
  });

  it('shows a share without dividing by zero', () => {
    expect(share({ part: 1, total: 3 })).toBe('33.3% (1 of 3)');
    expect(share({ part: 0, total: 0 })).toBe('no data');
  });
});
