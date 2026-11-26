export type Clock = {
  readonly now: () => Date;
};

export type ControllableClock = Clock & {
  readonly set: (instant: Date) => void;
  readonly advance: (milliseconds: number) => void;
};

export const systemClock: Clock = { now: () => new Date() };

export const createFixedClock = (initial: Date): ControllableClock => {
  let current = initial.getTime();
  return {
    now: () => new Date(current),
    set: (instant) => {
      current = instant.getTime();
    },
    advance: (milliseconds) => {
      current += milliseconds;
    },
  };
};

/** A clock shifted from a base clock by an offset that is read on every call. */
export const createOffsetClock = (base: Clock, offsetMs: () => number): Clock => ({
  now: () => new Date(base.now().getTime() + offsetMs()),
});
