import { BlockList, isIP } from 'node:net';

const familyOf = (address: string) => (isIP(address) === 6 ? 'ipv6' : 'ipv4');

/** Sockets on a dual-stack listener report IPv4 peers as `::ffff:a.b.c.d`. */
const unmapped = (address: string): string => address.replace(/^::ffff:(?=\d+\.)/i, '');

export const createProxyList = (cidrs: readonly string[]): BlockList => {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [address = '', prefix = ''] = cidr.split('/');
    list.addSubnet(address, Number(prefix), familyOf(address));
  }
  return list;
};

/**
 * The address of the real client. `X-Real-IP` counts only when the TCP peer is a trusted proxy;
 * `X-Forwarded-For` is never read, because a client can write anything into it.
 */
export const clientIp = (
  peer: string | undefined,
  realIpHeader: string | readonly string[] | undefined,
  trusted: BlockList,
): string => {
  const address = unmapped(peer ?? '');
  if (isIP(address) === 0) return 'unknown';
  const fromProxy = typeof realIpHeader === 'string' && isIP(realIpHeader) !== 0;
  return fromProxy && trusted.check(address, familyOf(address)) ? realIpHeader : address;
};
