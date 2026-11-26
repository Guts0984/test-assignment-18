import { createServer } from 'node:http';
import { Pool } from 'pg';
import { chaosFrom } from './chaos';
import { type StubEnv } from './config/env';
import { deliverDue } from './delivery';
import * as handlers from './http/handlers';
import { sendHtml, sendJson } from './http/io';
import { notFoundPage } from './http/pages';
import { migrate } from './store';

const ROUTES: readonly (readonly [string, RegExp, handlers.Handler])[] = [
  ['GET', /^\/$/, handlers.overview],
  ['GET', /^\/health$/, handlers.health],
  ['GET', /^\/api\/transactions$/, handlers.transactions],
  ['POST', /^\/sessions$/, handlers.createSession],
  ['POST', /^\/refunds$/, handlers.refund],
  ['GET', /^\/pay\/([^/]+)$/, handlers.showPayment],
  ['POST', /^\/pay\/([^/]+)\/pay$/, handlers.pay],
  ['POST', /^\/pay\/([^/]+)\/decline$/, handlers.decline],
  ['POST', /^\/pay\/([^/]+)\/close$/, handlers.close],
  ['POST', /^\/control$/, handlers.control],
];

const TICK_MS = 250;

export type Stub = {
  readonly url: string;
  readonly pool: Pool;
  readonly context: handlers.Context;
  readonly stop: () => Promise<void>;
};

export const startStub = async (
  env: StubEnv,
  options: { readonly random?: () => number; readonly onError?: (message: string) => void } = {},
): Promise<Stub> => {
  const pool = new Pool({ connectionString: env.PAYSTUB_DATABASE_URL, max: 20 });
  await migrate(pool);
  const onError = options.onError ?? (() => undefined);
  const flush = () =>
    deliverDue(pool, {
      key: env.PAYSTUB_MERCHANT_KEY,
      maxAttempts: env.PAYSTUB_RETRY_MAX,
      retryBaseMs: env.PAYSTUB_RETRY_BASE_MS,
    }).catch((error: unknown) => {
      onError(String(error));
    });
  const context: handlers.Context = {
    env,
    pool,
    chaos: chaosFrom(env),
    failRefunds: false,
    random: options.random ?? Math.random,
    flush,
  };

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://stub').pathname;
    for (const [method, pattern, handler] of ROUTES) {
      const match = method === request.method ? pattern.exec(path) : null;
      if (!match) continue;
      handler(context, { request, response, params: match.slice(1) }).catch((error: unknown) => {
        onError(String(error));
        if (!response.headersSent) sendJson(response, 500, { error: 'failure' });
      });
      return;
    }
    sendHtml(response, 404, notFoundPage());
  });
  // A request chosen to time out is never answered; the socket closes after this.
  server.requestTimeout = 15_000;

  await new Promise<void>((resolve) => {
    server.listen(env.PAYSTUB_PORT, '0.0.0.0', resolve);
  });
  const timer = setInterval(() => void flush(), TICK_MS);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : env.PAYSTUB_PORT;
  return {
    url: `http://127.0.0.1:${port}`,
    pool,
    context,
    stop: async () => {
      clearInterval(timer);
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      await pool.end();
    },
  };
};
