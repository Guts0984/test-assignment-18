/** How far the server clock is ahead of this device, measured when a response arrived. */
export const serverOffsetMs = (serverNow: string, receivedAtMs: number): number =>
  Date.parse(serverNow) - receivedAtMs;

/** Time left until a deadline by the server's clock, never negative. */
export const remainingMs = (deadline: string, offsetMs: number, deviceNowMs: number): number =>
  Math.max(0, Date.parse(deadline) - (deviceNowMs + offsetMs));

/** `14:59`, or `23:05:00` from an hour up. */
export const formatRemaining = (milliseconds: number): string => {
  const total = Math.ceil(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');
  const tail = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return hours > 0 ? `${hours}:${tail}` : tail;
};
