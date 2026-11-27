import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

type Config = {
  networks: { default: { ipam: { config: { subnet: string }[] } } };
  services: Record<
    string,
    { image?: string; build?: unknown; environment?: Record<string, string> }
  >;
};

const configWith = async (subnet: string): Promise<Config> => {
  const { stdout } = await promisify(execFile)(
    'docker',
    ['compose', 'config', '--format', 'json'],
    {
      env: { PATH: process.env['PATH'] ?? '', COMPOSE_SUBNET: subnet },
      maxBuffer: 5_000_000,
    },
  );
  return JSON.parse(stdout) as Config;
};

describe('compose', () => {
  // Docker Desktop fails when two builds write one tag.
  it('builds every image of its own exactly once', async () => {
    const { services } = await configWith('10.99.1.0/24');
    const own = Object.values(services).filter((service) => service.image?.startsWith('school-'));
    const built = own.filter((service) => service.build).map((service) => service.image);
    expect(built.sort()).toEqual([...new Set(own.map((service) => service.image))].sort());
  });

  // Otherwise every client would be counted as the proxy, and one could lock everyone out.
  it('trusts the proxy on whatever network is chosen', async () => {
    for (const subnet of ['10.99.1.0/24', '172.30.250.0/24']) {
      const config = await configWith(subnet);
      expect(config.networks.default.ipam.config[0]?.subnet).toBe(subnet);
      for (const api of ['api-1', 'api-2']) {
        expect(config.services[api]?.environment?.['TRUSTED_PROXY_CIDRS']).toBe(subnet);
      }
    }
  });
});
