import { type Db } from '@school/db/client';
import { roomName, type RealtimeEvent, type RealtimePayload } from '@school/shared/realtime/events';
import { Emitter } from '@socket.io/redis-emitter';
import { connectionFor } from './connection';

/** The Redis channel prefix shared by the Socket.IO adapter and every emitter. */
export const adapterKey = (prefix: string): string => `${prefix}:socket.io`;

export type Realtime = {
  /** Free seats for the catalog and a roster refresh for staff, after a commit. */
  readonly cohortsChanged: (db: Db, cohortIds: readonly string[]) => Promise<void>;
  readonly queueChanged: (mentorIds: readonly string[]) => void;
  readonly close: () => void;
};

type SeatRow = { id: string; free: number };

/**
 * Publishes live updates through Redis, so any process can reach clients connected to any api
 * copy. Updates are best effort: a lost one is repaired by the next refetch.
 */
export const createRealtime = (
  settings: { readonly redisUrl: string; readonly prefix: string },
  onError: (message: string) => void,
): Realtime => {
  const connection = connectionFor(settings.redisUrl);
  connection.on('error', (error) => {
    onError(error.message);
  });
  const publisher = {
    publish: (channel: string, message: unknown) => {
      if (connection.status !== 'ready') return;
      connection.publish(channel, message as Buffer).catch((error: unknown) => {
        onError(String(error));
      });
    },
  };
  const emitter = new Emitter(publisher, { key: adapterKey(settings.prefix) });
  const emit = <E extends RealtimeEvent>(room: string, event: E, payload: RealtimePayload<E>) => {
    emitter.to(room).emit(event, payload);
  };

  return {
    cohortsChanged: async (db, cohortIds) => {
      if (cohortIds.length === 0) return;
      try {
        const rows = await db.$queryRaw<SeatRow[]>`
          SELECT c.id, GREATEST(0, c.capacity - c.seats_taken - (
                   SELECT count(*) FROM waitlist_entries w
                    WHERE w.cohort_id = c.id AND w.status = 'waiting'))::int AS free
            FROM cohorts c WHERE c.id = ANY(${[...cohortIds]}::uuid[])`;
        for (const row of rows) {
          emit(roomName({ kind: 'catalog' }), 'seats.changed', {
            cohortId: row.id,
            freeSeats: row.free,
          });
          emit(roomName({ kind: 'cohort-staff', id: row.id }), 'roster.changed', {
            cohortId: row.id,
          });
        }
      } catch (error) {
        onError(String(error));
      }
    },
    queueChanged: (mentorIds) => {
      for (const mentorId of mentorIds) {
        emit(roomName({ kind: 'mentor', id: mentorId }), 'queue.changed', { mentorId });
      }
    },
    close: () => {
      connection.disconnect();
    },
  };
};
