import { z } from 'zod';
import { timeZoneSchema } from '../schedule/zoned';
import { ROLES } from '../status/actors';
import { emailSchema, idSchema, passwordSchema, text } from './common';

export const registerSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  fullName: text(2, 120),
  timeZone: timeZoneSchema,
});

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const updateProfileSchema = z.strictObject({ timeZone: timeZoneSchema });

export const accountSchema = z.object({
  id: idSchema,
  email: z.string(),
  fullName: z.string(),
  role: z.enum(ROLES),
  schoolId: idSchema.nullable(),
  timeZone: z.string(),
});

/** Registration answers the same way whether or not the address was already taken. */
export const acceptedSchema = z.object({ status: z.literal('accepted') });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type Account = z.infer<typeof accountSchema>;
