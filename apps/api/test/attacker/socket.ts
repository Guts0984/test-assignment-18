import { io } from 'socket.io-client';
import { ACCESS_COOKIE } from '../../src/common/auth/session';
import { type Client } from './client';

export type Received = { readonly event: string; readonly payload: unknown };

/** A real realtime client that records what reaches it. */
export const socket = async (
  url: string,
  options: { readonly as?: Client; readonly token?: string; readonly origin?: string } = {},
) => {
  const token = options.token ?? options.as?.cookies.get(ACCESS_COOKIE);
  const connection = io(url, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    extraHeaders: {
      ...(token ? { cookie: `${ACCESS_COOKIE}=${token}` } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
    },
  });
  const received: Received[] = [];
  connection.onAny((event: string, payload: unknown) => received.push({ event, payload }));
  await new Promise<void>((resolve, reject) => {
    connection.once('connect', resolve);
    connection.once('connect_error', reject);
  });
  return {
    received,
    connected: (): boolean => connection.connected,
    join: async (room: unknown): Promise<boolean> => {
      const reply = (await connection.timeout(5_000).emitWithAck('subscribe', room)) as {
        ok: boolean;
      };
      return reply.ok;
    },
    close: () => {
      connection.disconnect();
    },
  };
};
