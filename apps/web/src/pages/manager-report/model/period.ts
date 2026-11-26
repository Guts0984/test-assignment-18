import { reportQuerySchema, type ReportQuery } from '@school/shared/schemas/report';

const DAY = 86_400_000;

/** The last twelve months up to today, in UTC days. */
export const defaultPeriod = (now: Date): { from: string; to: string } => ({
  from: new Date(now.getTime() - 364 * DAY).toISOString().slice(0, 10),
  to: now.toISOString().slice(0, 10),
});

/** The report asked for by the address; the default period fills what is missing. */
export const reportFromUrl = (
  query: Readonly<Partial<Record<string, string>>>,
  now: Date,
): { readonly query: ReportQuery } | { readonly problem: string } => {
  const parsed = reportQuerySchema.safeParse({ ...defaultPeriod(now), ...query });
  return parsed.success
    ? { query: parsed.data }
    : { problem: parsed.error.issues.map((issue) => issue.message).join('. ') };
};

export const share = (value: { readonly part: number; readonly total: number }): string =>
  value.total === 0
    ? 'no data'
    : `${Math.round((value.part * 1000) / value.total) / 10}% (${value.part} of ${value.total})`;
