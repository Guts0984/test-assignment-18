const FIRST_MS = 500;
const LONGEST_MS = 30_000;

/** How long to wait before another try: doubling, up to half a minute. */
export const retryDelayMs = (attempt: number): number =>
  Math.min(FIRST_MS * 2 ** attempt, LONGEST_MS);
