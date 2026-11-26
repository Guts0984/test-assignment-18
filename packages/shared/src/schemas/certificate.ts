import { z } from 'zod';
import { idSchema, instantSchema, text } from './common';

export const certificateSchema = z.object({
  id: idSchema,
  courseTitle: z.string(),
  number: z.number().int(),
  issuedAt: instantSchema,
  /** The public link that confirms the certificate is genuine. */
  verifyUrl: z.url(),
});
export const certificateListSchema = z.object({ items: z.array(certificateSchema) });

export const verifyParamSchema = z.strictObject({ token: text(20, 200) });
export const verifiedSchema = z.object({
  studentName: z.string(),
  courseTitle: z.string(),
  schoolName: z.string(),
  number: z.number().int(),
  issuedAt: instantSchema,
});

export type CertificateView = z.infer<typeof certificateSchema>;
