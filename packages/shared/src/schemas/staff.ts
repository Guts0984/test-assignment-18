import { z } from 'zod';
import { STAFF_ROLES } from '../status/actors';
import { emailSchema, idSchema, passwordSchema, text } from './common';

/** Roles an administrator hands out. Administrators themselves are not managed here. */
export const MANAGED_ROLES = ['manager', 'mentor'] as const;

export const createStaffSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
  fullName: text(2, 120),
  role: z.enum(MANAGED_ROLES),
});

export const updateStaffSchema = z
  .strictObject({
    fullName: text(2, 120).optional(),
    role: z.enum(MANAGED_ROLES).optional(),
    disabled: z.boolean().optional(),
  })
  .refine((change) => Object.keys(change).length > 0, { error: 'Nothing to change' });

export const staffMemberSchema = z.object({
  id: idSchema,
  email: z.string(),
  fullName: z.string(),
  role: z.enum(STAFF_ROLES),
  disabled: z.boolean(),
  /** Cohorts not yet over that this person mentors. While above zero they must stay a mentor. */
  openCohorts: z.number().int().min(0),
});

export const staffListSchema = z.object({ items: z.array(staffMemberSchema) });

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
export type StaffMember = z.infer<typeof staffMemberSchema>;
