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
    socket.on('connect', () => {
      socket.emit('subscribe', room);
      latest.current.onResync();
    });
    socket.on('connect_error', (error) => {
      if (error.message !== 'UNAUTHENTICATED') return;
      void refreshSession().then((renewed) => {
        if (renewed) socket.connect();
      });
    });
    const event: string = latest.current.event;
    socket.on(event, (payload: unknown) => {
      const parsed = REALTIME_EVENTS[latest.current.event].safeParse(payload);
      if (parsed.success) latest.current.onEvent(parsed.data as RealtimePayload<E>);
    });
    return () => {
      socket.disconnect();
    };
  }, [key]);
};
