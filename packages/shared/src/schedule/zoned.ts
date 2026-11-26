import { DateTime, IANAZone } from 'luxon';
import { z } from 'zod';

const MINUTE = 60_000;
const DAY = 86_400_000;

export const isValidTimeZone = (zone: string): boolean => IANAZone.isValidZone(zone);

export const timeZoneSchema = z
  .string()
  .max(64)
  .refine(isValidTimeZone, { error: 'Unknown time zone' });

/** Dates outside this century are rejected before they can reach the database. */
export const localDateSchema = z.iso
  .date()
  .refine((date) => date >= '2000-01-01' && date <= '2100-12-31', {
    error: 'Date must be between 2000-01-01 and 2100-12-31',
  });
export const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm (24-hour)');

const offsetMinutes = (instantMs: number, zone: string): number =>
  DateTime.fromMillis(instantMs, { zone }).offset;

const findTransition = (fromMs: number, toMs: number, zone: string): number => {
  const after = offsetMinutes(toMs, zone);
  let low = fromMs;
  let high = toMs;
  while (high - low > MINUTE) {
    const middle = low + Math.floor((high - low) / (2 * MINUTE)) * MINUTE;
    if (offsetMinutes(middle, zone) === after) high = middle;
    else low = middle;
  }
  return high;
};

/**
 * The instant at which the wall clock in `zone` shows `localDate localTime`.
 * A time that occurs twice (autumn) resolves to the first occurrence. A time that does not
 * exist (spring) resolves to the first instant after the gap.
 */
export const zonedInstant = (localDate: string, localTime: string, zone: string): Date => {
  const wallMs = Date.parse(`${localDate}T${localTime}:00.000Z`);
  if (Number.isNaN(wallMs) || !isValidTimeZone(zone)) {
    throw new RangeError(`Invalid local date-time: ${localDate} ${localTime} ${zone}`);
  }
  const offsets = [offsetMinutes(wallMs - DAY, zone), offsetMinutes(wallMs + DAY, zone)];
  const candidates = offsets.map((offset) => wallMs - offset * MINUTE);
  const valid = candidates.filter(
    (candidate) => candidate + offsetMinutes(candidate, zone) * MINUTE === wallMs,
  );
  if (valid.length > 0) return new Date(Math.min(...valid));
  return new Date(findTransition(Math.min(...candidates), Math.max(...candidates), zone));
};

/** Calendar arithmetic on a local date, independent of any time zone. */
export const addDays = (localDate: string, days: number): string =>
  new Date(Date.parse(`${localDate}T00:00:00.000Z`) + days * DAY).toISOString().slice(0, 10);

/** ISO weekday: 1 is Monday, 7 is Sunday. */
export const isoWeekday = (localDate: string): number => {
  const day = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
};
