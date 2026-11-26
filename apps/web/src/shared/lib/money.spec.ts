import { describe, expect, it } from 'vitest';
import { parseMajor, toMajor } from './money';

describe('amount input', () => {
  it.each([
    ['0', 0],
    ['250', 25_000],
    ['250.5', 25_050],
    ['250,05', 25_005],
    [' 19.99 ', 1_999],
    ['1234567.89', 123_456_789],
  ])('reads %j', (text, minor) => {
    expect(parseMajor(text)).toBe(minor);
  });

  it.each(['', '-1', '1.234', '1e3', 'abc', '1 000', '.5', 'Infinity', '123456789'])(
    'refuses %j',
    (text) => {
      expect(parseMajor(text)).toBeNull();
    },
  );

  it('round-trips', () => {
    expect(parseMajor(toMajor(1_005))).toBe(1_005);
  });
});
