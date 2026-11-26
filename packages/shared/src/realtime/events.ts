import { z } from 'zod';
import { ENROLLMENT_STATUSES } from '../status/enrollment';

const id = z.uuid();

export const REALTIME_EVENTS = {
  'seats.changed': z.object({ cohortId: id, freeSeats: z.number().int().min(0) }),
  'queue.changed': z.object({ mentorId: id }),
  'roster.changed': z.object({ cohortId: id }),
  'enrollment.changed': z.object({
    enrollmentId: id,
    status: z.enum(ENROLLMENT_STATUSES),
    holdExpiresAt: z.iso.datetime().nullable(),
    serverNow: z.iso.datetime(),
  }),
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
