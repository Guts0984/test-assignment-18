import { type Db } from '@school/db/client';
import { roomName, type RealtimeEvent, type RealtimePayload } from '@school/shared/realtime/events';
import { Emitter } from '@socket.io/redis-emitter';
import { connectionFor, settled } from './connection';

/** Rooms the server puts sockets in itself; clients cannot ask for them. */
export const internalRoom = (kind: 'session' | 'account', id: string): string => `${kind}:${id}`;

/** The Redis channel prefix shared by the Socket.IO adapter and every emitter. */
export const adapterKey = (prefix: string): string => `${prefix}:socket.io`;

export type Realtime = {
  /** Free seats for the catalog and a roster refresh for staff, after a commit. */
  readonly cohortsChanged: (db: Db, cohortIds: readonly string[]) => Promise<void>;
  readonly queueChanged: (mentorIds: readonly string[]) => void;
  /** Closes the sockets of one signed-in session, on every api copy. */
  readonly endSession: (sessionId: string) => void;
  /** Closes every socket of an account. */
  readonly endAccount: (userId: string) => void;
  /** Takes an account out of a cohort's staff room, for example a replaced mentor. */
  readonly leaveCohort: (userId: string, cohortId: string) => void;
  readonly close: () => Promise<void>;
};

type SeatRow = { id: string; free: number; mentor_id: string };

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
          SELECT c.id, c.mentor_id, GREATEST(0, c.capacity - c.seats_taken - (
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
          // Someone leaving takes their work out of the mentor's queue.
          emit(roomName({ kind: 'mentor', id: row.mentor_id }), 'queue.changed', {
            mentorId: row.mentor_id,
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
    endSession: (sessionId) => {
      emitter.in(internalRoom('session', sessionId)).disconnectSockets(true);
    },
    endAccount: (userId) => {
      emitter.in(internalRoom('account', userId)).disconnectSockets(true);
    },
    leaveCohort: (userId, cohortId) => {
      emitter
        .in(internalRoom('account', userId))
        .socketsLeave(roomName({ kind: 'cohort-staff', id: cohortId }));
    },
    close: async () => {
      await settled(connection);
      connection.disconnect();
    },
  };
};
