import { type INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { settled } from '@school/queue/connection';
import { adapterKey } from '@school/queue/realtime';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { type Server, type ServerOptions } from 'socket.io';
import { type Deps } from './deps';

const MAX_MESSAGE_BYTES = 4_096;

const ADAPTER_COMMANDS = ['subscribe', 'psubscribe', 'unsubscribe', 'punsubscribe', 'publish'];

/**
 * The adapter sends these without watching the result, so a lost connection would surface as an
 * unhandled rejection. Each result is observed and logged instead.
 */
const observeFailures = (connection: Redis, deps: Deps): void => {
  const commands = connection as unknown as Record<
    string,
    (...args: unknown[]) => Promise<unknown>
  >;
  for (const name of ADAPTER_COMMANDS) {
    const send = commands[name]?.bind(connection);
    if (!send) continue;
    commands[name] = (...args) => {
      const result = send(...args);
      result.catch((error: unknown) => {
        deps.logger.warn({ command: name, error: String(error) }, 'socket adapter command failed');
      });
      return result;
    };
  }
};

/**
 * Socket.IO over WebSocket only, so no sticky sessions are needed, connected to the other api
 * copies through Redis. Browsers from a foreign origin are refused at the handshake.
 */
export class SocketAdapter extends IoAdapter {
  private readonly connections: readonly [Redis, Redis];

  constructor(
    app: INestApplicationContext,
    private readonly deps: Deps,
  ) {
    super(app);
    const publish = new Redis(deps.env.REDIS_URL, { maxRetriesPerRequest: null });
    const subscribe = publish.duplicate();
    for (const connection of [publish, subscribe]) {
      connection.on('error', (error) => {
        deps.logger.warn({ error: error.message }, 'socket adapter redis error');
      });
    }
    for (const connection of [publish, subscribe]) observeFailures(connection, deps);
    this.connections = [publish, subscribe];
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      transports: ['websocket'],
      serveClient: false,
      maxHttpBufferSize: MAX_MESSAGE_BYTES,
      allowRequest: (request, callback) => {
        const { origin } = request.headers;
        callback(null, origin === undefined || this.deps.env.CORS_ORIGINS.includes(origin));
      },
    } satisfies Partial<ServerOptions>) as Server;
    server.adapter(
      createAdapter(...this.connections, { key: adapterKey(this.deps.env.QUEUE_PREFIX) }),
    );
    return server;
  }

  override async dispose(): Promise<void> {
    await Promise.all(this.connections.map((connection) => settled(connection)));
    for (const connection of this.connections) connection.disconnect();
  }
}
