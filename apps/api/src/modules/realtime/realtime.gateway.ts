import { Inject } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { roomName, roomSchema } from '@school/shared/realtime/events';
import { type Server, type Socket } from 'socket.io';
import { internalRoom } from '@school/queue/realtime';
import { type Principal } from '../../common/auth/principal';
import { ACCESS_COOKIE, authenticate, principalOfSession } from '../../common/auth/session';
import { readCookie } from '../../common/http/request';
import { DEPS, type Deps } from '../../infra/deps';
import { mayJoin } from './access';

type SocketData = { principal?: Principal | undefined };
type Ack = { readonly ok: boolean };

@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  /** A connection with bad credentials is refused; one without any may watch the catalog. */
  afterInit(server: Server): void {
    server.use((socket, next) => {
      const token = readCookie(socket.handshake.headers.cookie, ACCESS_COOKIE);
      if (token === undefined) {
        next();
        return;
      }
      authenticate({ db: this.deps.db, secret: this.deps.env.JWT_ACCESS_SECRET }, token)
        .then(async (principal) => {
          if (!principal) {
            next(new Error('UNAUTHENTICATED'));
            return;
          }
          (socket.data as SocketData).principal = principal;
          // So that ending the session or disabling the account can close this socket.
          await socket.join([
            internalRoom('session', principal.sessionId),
            internalRoom('account', principal.id),
          ]);
          next();
        })
        .catch(() => {
          next(new Error('UNAVAILABLE'));
        });
    });
  }

  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() message: unknown,
  ): Promise<Ack> {
    const room = roomSchema.safeParse(message);
    if (!room.success) return { ok: false };
    const { principal } = socket.data as SocketData;
    // Checked again: the session may have ended, or the role changed, since the connection.
    const known =
      principal &&
      (await principalOfSession(this.deps.db, {
        userId: principal.id,
        sessionId: principal.sessionId,
      }));
    if (!(await mayJoin(this.deps.db, known, room.data))) return { ok: false };
    await socket.join(roomName(room.data));
    return { ok: true };
  }
}
