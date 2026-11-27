'use client';

import {
  REALTIME_EVENTS,
  type RealtimeEvent,
  type RealtimePayload,
  type Room,
} from '@school/shared/realtime/events';
import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { env } from '@/config/env';
import { refreshSession } from '@/shared/api';
import { retryDelayMs } from './retry-delay';

/**
 * Listens to one event of one room while the component is shown. Every connection, first or
 * restored, joins the room and calls `onResync`, so updates missed offline are fetched again.
 */
export const useLive = <E extends RealtimeEvent>(input: {
  readonly room: Room | null;
  readonly event: E;
  readonly onEvent: (payload: RealtimePayload<E>) => void;
  readonly onResync: () => void;
}): void => {
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  const key = input.room ? JSON.stringify(input.room) : null;

  useEffect(() => {
    if (!key) return undefined;
    const room = JSON.parse(key) as Room;
    const socket: Socket = io({ path: env.NEXT_PUBLIC_SOCKET_PATH, transports: ['websocket'] });
    let gone = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Socket.IO does not come back by itself when the server closed or refused the connection,
    // as it does when a session ends.
    const comeBack = () => {
      if (gone || socket.active) return;
      clearTimeout(retry);
      retry = setTimeout(() => socket.connect(), retryDelayMs(attempt));
      attempt += 1;
    };
    socket.on('disconnect', comeBack);
    socket.on('connect', () => {
      attempt = 0;
      socket.emit('subscribe', room);
      latest.current.onResync();
    });
    socket.on('connect_error', (error) => {
      // A refused refresh clears the cookies, so the next try connects as a visitor.
      if (error.message === 'UNAUTHENTICATED') void refreshSession().then(comeBack);
      else comeBack();
    });
    const event: string = latest.current.event;
    socket.on(event, (payload: unknown) => {
      const parsed = REALTIME_EVENTS[latest.current.event].safeParse(payload);
      if (parsed.success) latest.current.onEvent(parsed.data as RealtimePayload<E>);
    });
    return () => {
      gone = true;
      clearTimeout(retry);
      socket.disconnect();
    };
  }, [key]);
};
