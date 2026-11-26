import { z } from 'zod';

const NUL = String.fromCharCode(0);

/** Trimmed text without NUL characters, which PostgreSQL cannot store. */
export const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !value.includes(NUL), { error: 'Contains a forbidden character' });

export const idSchema = z.uuid();
export const idParamSchema = z.strictObject({ id: idSchema });
export const instantSchema = z.iso.datetime();
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const passwordSchema = z.string().min(10).max(128);

/** Query-string pagination. */
export const pageShape = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
} as const;

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
  });
