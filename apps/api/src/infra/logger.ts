import pino, { type Logger } from 'pino';

export type { Logger };

/** Fields that are replaced before anything is written. */
export const REDACTED_PATHS = [
  'password',
  '*.password',
  'token',
  '*.token',
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'key',
  '*.key',
] as const;

export const createLogger = (level: string): Logger =>
  pino({ level, redact: { paths: [...REDACTED_PATHS], censor: '[redacted]' } });
