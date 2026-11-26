import { request as httpRequest } from 'node:http';

export type Reply = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly text: string;
  readonly body: unknown;
};

export type SendOptions = {
  readonly body?: unknown;
  /** Sent as is, for malformed or oversized payloads. */
  readonly raw?: string | Buffer;
  readonly headers?: Readonly<Record<string, string>>;
};

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/**
 * A real HTTP client with its own cookie jar and, optionally, its own source address
 * (any `127.0.0.N` works on Linux).
 */
export const client = (baseUrl: string, options: { readonly ip?: string } = {}) => {
  const jar = new Map<string, string>();

  const send = (method: string, path: string, request: SendOptions = {}): Promise<Reply> => {
    const payload =
      request.raw ?? (request.body === undefined ? undefined : JSON.stringify(request.body));
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        new URL(path, baseUrl),
        {
          method,
          localAddress: options.ip,
          headers: {
            ...(payload === undefined
              ? {}
              : {
                  'content-type': 'application/json',
                  'content-length': String(Buffer.byteLength(payload)),
                }),
            ...(cookie ? { cookie } : {}),
            ...request.headers,
          },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => {
            for (const line of incoming.headers['set-cookie'] ?? []) {
              const [pair = ''] = line.split(';');
              const split = pair.indexOf('=');
              const value = pair.slice(split + 1);
              if (value) jar.set(pair.slice(0, split), value);
              else jar.delete(pair.slice(0, split));
            }
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({
              status: incoming.statusCode ?? 0,
              headers: incoming.headers,
              text,
              body: parse(text),
            });
          });
        },
      );
      outgoing.on('error', reject);
      outgoing.end(payload);
    });
  };

  return {
    send,
    cookies: jar,
    get: (path: string, request?: SendOptions) => send('GET', path, request),
    post: (path: string, body?: unknown, request?: SendOptions) =>
      send('POST', path, { ...request, body }),
    patch: (path: string, body?: unknown, request?: SendOptions) =>
      send('PATCH', path, { ...request, body }),
  };
};

export type Client = ReturnType<typeof client>;
