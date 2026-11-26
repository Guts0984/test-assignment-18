import { describe, expect, it } from 'vitest';
import { clientIp, createProxyList } from './client-ip';

const trusted = createProxyList(['172.16.0.0/12', 'fd00::/8']);

describe('clientIp', () => {
  it('believes X-Real-IP only from a trusted proxy', () => {
    expect(clientIp('172.18.0.5', '203.0.113.9', trusted)).toBe('203.0.113.9');
    expect(clientIp('::ffff:172.18.0.5', '203.0.113.9', trusted)).toBe('203.0.113.9');
    expect(clientIp('fd00::1', '203.0.113.9', trusted)).toBe('203.0.113.9');
  });

  it('ignores the header from anyone else', () => {
    expect(clientIp('198.51.100.7', '203.0.113.9', trusted)).toBe('198.51.100.7');
    expect(clientIp('172.32.0.1', '203.0.113.9', trusted)).toBe('172.32.0.1');
  });

  it.each(['not-an-ip', '1.2.3.4, 5.6.7.8', '', undefined, ['1.2.3.4', '5.6.7.8']])(
    'falls back to the peer for the header %j',
    (header) => {
      expect(clientIp('172.18.0.5', header, trusted)).toBe('172.18.0.5');
    },
  );

  it('does not trust a missing peer address', () => {
    expect(clientIp(undefined, '203.0.113.9', trusted)).toBe('unknown');
  });
});
