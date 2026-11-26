import { z } from 'zod';
import { instantSchema, text } from './common';

export const gatewayConfigInputSchema = z.strictObject({
  baseUrl: z.url({ protocol: /^https?$/ }).max(300),
  key: text(16, 200),
});

/** The key itself is write-only. */
export const gatewayConfigSchema = z.object({
  configured: z.boolean(),
  baseUrl: z.string().nullable(),
  keyLast4: z.string().nullable(),
  updatedAt: instantSchema.nullable(),
});

export type GatewayConfigInput = z.infer<typeof gatewayConfigInputSchema>;
