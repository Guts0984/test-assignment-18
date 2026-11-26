import { z } from 'zod';
import { discountSchema } from '../pricing/promo';
import { idSchema, instantSchema, pageOf, pageShape } from './common';
import { promoCodeInputSchema } from './enrollment';

const maxUses = z.number().int().min(1).max(1_000_000);

export const createPromoSchema = z
  .strictObject({
    code: promoCodeInputSchema,
    courseId: idSchema.nullable().default(null),
    discount: discountSchema,
    validFrom: instantSchema,
    validUntil: instantSchema,
    maxUses,
  })
  .refine((promo) => Date.parse(promo.validUntil) > Date.parse(promo.validFrom), {
    error: 'The end must be after the start',
    path: ['validUntil'],
  });

export const updatePromoSchema = z
  .strictObject({ maxUses: maxUses.optional(), validUntil: instantSchema.optional() })
  .refine((change) => Object.keys(change).length > 0, { error: 'Nothing to change' });

export const promoSchema = z.object({
  id: idSchema,
  code: z.string(),
  courseId: idSchema.nullable(),
  discount: discountSchema,
  validFrom: instantSchema,
  validUntil: instantSchema,
  maxUses: z.number().int(),
  usedCount: z.number().int(),
  reservedCount: z.number().int(),
});

export const promoQuerySchema = z.strictObject(pageShape);
export const promoPageSchema = pageOf(promoSchema);

export type CreatePromoInput = z.infer<typeof createPromoSchema>;
export type UpdatePromoInput = z.infer<typeof updatePromoSchema>;
export type PromoView = z.infer<typeof promoSchema>;
