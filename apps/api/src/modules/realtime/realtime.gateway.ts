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
import { type Principal } from '../../common/auth/principal';
import { ACCESS_COOKIE, authenticate } from '../../common/auth/session';
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
        .then((principal) => {
          if (!principal) {
            next(new Error('UNAUTHENTICATED'));
            return;
          }
          (socket.data as SocketData).principal = principal;
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
    // The account is checked again: it may have been disabled since the connection opened.
    const current =
      principal &&
      (await this.deps.db.user.findFirst({ where: { id: principal.id, disabledAt: null } }));
    const known = current ? principal : undefined;
    if (!(await mayJoin(this.deps.db, known, room.data))) return { ok: false };
    await socket.join(roomName(room.data));
    return { ok: true };
  }
}
