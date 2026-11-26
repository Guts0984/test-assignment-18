import { z } from 'zod';
import { QUEUE_NAMES } from '../jobs/registry';
import { idSchema, instantSchema, pageOf, pageShape } from './common';

export const failedJobSchema = z.object({
  id: idSchema,
  queue: z.enum(QUEUE_NAMES),
  recordId: z.string(),
  error: z.string(),
  attempts: z.number().int(),
  failedAt: instantSchema,
});
export const failedJobQuerySchema = z.strictObject(pageShape);
export const failedJobPageSchema = pageOf(failedJobSchema);
