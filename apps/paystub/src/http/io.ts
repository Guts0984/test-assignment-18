import { type IncomingMessage, type ServerResponse } from 'node:http';

const MAX_BODY = 16_384;

export const readBody = async (request: IncomingMessage): Promise<Buffer | 'too_large'> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) return 'too_large';
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
} as const;

export const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { ...SECURITY, 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

export const sendHtml = (response: ServerResponse, status: number, html: string): void => {
  response.writeHead(status, { ...SECURITY, 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
};

export const redirect = (response: ServerResponse, location: string): void => {
  response.writeHead(303, { ...SECURITY, location });
  response.end();
};
