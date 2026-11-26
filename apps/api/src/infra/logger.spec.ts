import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACTED_PATHS } from './logger';

describe('log redaction', () => {
  it('never writes passwords, tokens, cookies or keys', () => {
    const lines: string[] = [];
    const logger = pino(
      { redact: { paths: [...REDACTED_PATHS], censor: '[redacted]' } },
      { write: (line: string) => lines.push(line) },
    );
    logger.info({
      password: 'p-secret',
      token: 't-secret',
      cookie: 'c-secret',
      key: 'k-secret',
      authorization: 'a-secret',
      body: { password: 'p2-secret', token: 't2-secret', key: 'k2-secret' },
      headers: { cookie: 'c2-secret', authorization: 'a2-secret' },
    });
    expect(lines.join('')).not.toContain('secret');
    expect(lines.join('')).toContain('[redacted]');
  });
});
