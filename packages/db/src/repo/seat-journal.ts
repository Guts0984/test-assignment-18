import { type Actor } from '@school/shared/status/actors';
import { type Tx } from '../client';

export type SeatReason =
  'hold' | 'payment' | 'expiry' | 'offer' | 'transfer_in' | 'transfer_out' | 'cancel' | 'exclude';

export type ActorRef = {
  readonly kind: Actor;
  /** Null for the system. */
  readonly id: string | null;
};

export const SYSTEM_ACTOR: ActorRef = { kind: 'system', id: null };

/** Records a change of occupancy. The database updates the cohort counter from this row. */
export const journalSeats = async (
  tx: Tx,
  entry: {
    readonly cohortId: string;
    readonly enrollmentId: string;
    readonly seatsDelta: -1 | 0 | 1;
    readonly reason: SeatReason;
    readonly actor: ActorRef;
    readonly at: Date;
  },
): Promise<void> => {
  const { actor, ...row } = entry;
  await tx.seatJournal.create({ data: { ...row, actorKind: actor.kind, actorId: actor.id } });
};

export const journalCapacity = async (
  tx: Tx,
  entry: {
    readonly cohortId: string;
    readonly capacityDelta: number;
    readonly actor: ActorRef;
    readonly at: Date;
  },
): Promise<void> => {
  const { actor, ...row } = entry;
  await tx.seatJournal.create({
    data: { ...row, seatsDelta: 0, reason: 'capacity', actorKind: actor.kind, actorId: actor.id },
  });
};
