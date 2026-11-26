import { z } from 'zod';

const id = z.uuid();

export const REALTIME_EVENTS = {
  'seats.changed': z.object({ cohortId: id, freeSeats: z.number().int().min(0) }),
  'queue.changed': z.object({ mentorId: id }),
  'roster.changed': z.object({ cohortId: id }),
} as const;

export type RealtimeEvent = keyof typeof REALTIME_EVENTS;
export type RealtimePayload<E extends RealtimeEvent> = z.infer<(typeof REALTIME_EVENTS)[E]>;

export const roomSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('catalog') }),
  z.strictObject({ kind: z.literal('user'), id }),
  z.strictObject({ kind: z.literal('mentor'), id }),
  z.strictObject({ kind: z.literal('cohort-staff'), id }),
]);
export type Room = z.infer<typeof roomSchema>;

export const roomName = (room: Room): string =>
  room.kind === 'catalog' ? 'catalog' : `${room.kind}:${room.id}`;
