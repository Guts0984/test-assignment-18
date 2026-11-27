import { type Server } from 'node:http';
import { Server as Listener } from 'node:net';
import { type RequestHandler, type Response } from 'express';

const POLL_MS = 25;

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Asks the proxy not to reuse the connection this answer goes out on. */
const lastOnItsConnection = (response: Response): void => {
  if (!response.headersSent) response.setHeader('Connection', 'close');
};

export type Drain = {
  /** Keeps track of the requests being answered. */
  readonly middleware: RequestHandler;
  /**
   * Stops taking new connections, so the proxy turns to another copy, and keeps serving the ones
   * already open. Resolves once nothing has been asked for `quietMs`, or after `limitMs`.
   */
  readonly leave: (
    server: Server,
    timing: { readonly quietMs: number; readonly limitMs: number },
  ) => Promise<void>;
};

export const createDrain = (): Drain => {
  const open = new Set<Response>();
  let leaving = false;
  let lastActivity = 0;
  return {
    middleware: (_request, response, next) => {
      open.add(response);
      lastActivity = Date.now();
      response.once('close', () => {
        open.delete(response);
        lastActivity = Date.now();
      });
      if (leaving) lastOnItsConnection(response);
      next();
    },
    leave: async (server, { quietMs, limitMs }) => {
      leaving = true;
      lastActivity = Date.now();
      open.forEach(lastOnItsConnection);
      // Only the listening socket. `server.close()` would also drop open connections that look
      // idle, among them ones carrying a request that is still on its way.
      Listener.prototype.close.call(server);
      const deadline = Date.now() + limitMs;
      const busy = () => open.size > 0 || Date.now() - lastActivity < quietMs;
      while (busy() && Date.now() < deadline) await pause(POLL_MS);
    },
  };
};
