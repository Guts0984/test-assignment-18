import { DateTime } from 'luxon';

export type ZonedParts = {
  readonly date: string;
  readonly time: string;
  /** For example `+03:00`. */
  readonly offset: string;
  readonly timeZone: string;
};

/** The wall-clock reading of an instant in a viewer's time zone. */
export const toZonedParts = (instant: Date, timeZone: string): ZonedParts => {
  const local = DateTime.fromJSDate(instant, { zone: timeZone });
  if (!local.isValid) throw new RangeError(`Invalid instant or time zone: ${timeZone}`);
  return {
    date: local.toFormat('yyyy-MM-dd'),
    time: local.toFormat('HH:mm'),
    offset: local.toFormat('ZZ'),
    timeZone,
  };
};

export const formatInZone = (instant: Date, timeZone: string, locale = 'en-GB'): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
