import { describe, expect, it } from 'vitest';
import { open, seal } from './secret-box';
import { sign, verify } from './signature';

const key = 'a-merchant-key-of-some-length';
const now = new Date('2026-03-01T10:00:00Z');
const body = '{"eventId":"1","amountMinor":100}';
const header = sign(key, body, now);
const check = (over: Partial<Parameters<typeof verify>[0]> = {}) =>
  verify({ key, header, body, now, maxSkewSec: 300, ...over });
const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);

describe('signatures', () => {
  it('accepts the signed body within the allowed age', () => {
    expect(check()).toBe(true);
    expect(check({ now: later(300) })).toBe(true);
    expect(check({ now: later(-300) })).toBe(true);
  });

  it.each([
    { body: body.replace('100', '101') },
    { key: 'another-key-of-the-same-length' },
    { now: later(301) },
    { now: later(-301) },
    { header: undefined },
    { header: '' },
    { header: header.replace(/t=\d+/, `t=${Math.floor(now.getTime() / 1000) + 1}`) },
    { header: header.slice(0, -2) },
    { header: `${header},v1=${'0'.repeat(64)}` },
  ])('rejects %o', (change) => {
    expect(check(change)).toBe(false);
  });
});

describe('secret box', () => {
  const secret = Buffer.alloc(32, 7).toString('base64');

  it('round-trips without storing the plaintext, differently each time', () => {
    const first = seal(key, secret);
    expect(first).not.toContain(key);
    expect(seal(key, secret)).not.toBe(first);
    expect(open(first, secret)).toBe(key);
  });

  it('refuses a tampered box, a wrong key and a short key', () => {
    const [iv, tag, data = ''] = seal(key, secret).split('.');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => open([iv, tag, flipped.toString('base64')].join('.'), secret)).toThrow();
    expect(() => open(seal(key, secret), Buffer.alloc(32, 8).toString('base64'))).toThrow();
    expect(() => seal(key, 'c2hvcnQ=')).toThrow('32 bytes');
  });
});
