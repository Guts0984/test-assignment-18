import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

type Config = {
  networks: { default: { ipam: { config: { subnet: string }[] } } };
  services: Record<string, { environment?: Record<string, string> }>;
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
