import { formatInZone } from '@school/shared/schedule/display';

export const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** An instant on the wall clock of a zone, with the zone named. */
export const formatWhen = (iso: string, timeZone: string): string =>
  `${formatInZone(new Date(iso), timeZone)} (${timeZone})`;

export const formatShort = (iso: string, timeZone: string): string =>
  formatInZone(new Date(iso), timeZone);

export const formatDay = (isoDate: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
