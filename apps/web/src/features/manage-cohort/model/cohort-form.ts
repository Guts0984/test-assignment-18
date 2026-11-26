import { createCohortSchema, type CreateCohortInput } from '@school/shared/schemas/manage';
import { parseMajor } from '@/shared/lib';

export type CohortFields = {
  readonly courseId: string;
  readonly mentorId: string;
  readonly startDate: string;
  readonly timeZone: string;
  readonly capacity: string;
  readonly price: string;
  readonly currency: string;
  readonly weekdays: readonly number[];
  readonly localTime: string;
  readonly count: string;
};

export type FieldProblems = Readonly<Partial<Record<keyof CohortFields, string>>>;

/** Server and schema paths, mapped to the fields of the form. */
export const FIELD_OF_PATH: Readonly<Record<string, keyof CohortFields>> = {
  courseId: 'courseId',
  mentorId: 'mentorId',
  startDate: 'startDate',
  timeZone: 'timeZone',
  capacity: 'capacity',
  priceMinor: 'price',
  currency: 'currency',
  'schedule.weekdays': 'weekdays',
  'schedule.localTime': 'localTime',
  'schedule.count': 'count',
};

/** Turns what was typed into a request, or says which fields are wrong. */
export const toCohortInput = (
  fields: CohortFields,
): { readonly input: CreateCohortInput } | { readonly problems: FieldProblems } => {
  const priceMinor = parseMajor(fields.price);
  const parsed = createCohortSchema.safeParse({
    courseId: fields.courseId,
    mentorId: fields.mentorId,
    startDate: fields.startDate,
    timeZone: fields.timeZone,
    capacity: Number(fields.capacity),
    priceMinor: priceMinor ?? -1,
    currency: fields.currency,
    schedule: {
      weekdays: fields.weekdays,
      localTime: fields.localTime,
      count: Number(fields.count),
    },
  });
  if (parsed.success) return { input: parsed.data };
  const problems: Partial<Record<keyof CohortFields, string>> = {};
  for (const issue of parsed.error.issues) {
    const field =
      FIELD_OF_PATH[issue.path.slice(0, 2).join('.')] ?? FIELD_OF_PATH[String(issue.path[0])];
    if (field) problems[field] ??= issue.message;
  }
  if (priceMinor === null) problems.price = 'Enter an amount such as 250 or 250.50';
  return { problems };
};
