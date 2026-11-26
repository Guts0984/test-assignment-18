import pino, { type Logger } from 'pino';

export type { Logger };

export const createLogger = (level: string): Logger =>
  pino({
    level,
    redact: {
      paths: [
        'password',
        '*.password',
        'token',
        '*.token',
        'authorization',
        'cookie',
        '*.cookie',
        '*.authorization',
        'key',
        '*.key',
      ],
      censor: '[redacted]',
    },
  });
