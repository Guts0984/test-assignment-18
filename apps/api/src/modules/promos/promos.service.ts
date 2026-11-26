import { Inject, Injectable } from '@nestjs/common';
import { type PromoCode } from '@school/db/client';
import { isUniqueViolation } from '@school/db/errors';
import { discountOf } from '@school/db/repo/promo-use';
import { inTransaction } from '@school/db/transaction';
import {
  type CreatePromoInput,
  type PromoView,
  type UpdatePromoInput,
} from '@school/shared/schemas/promo';
import { apiError } from '../../common/errors/api-error';
import { rejected } from '../../common/errors/rejections';
import { DEPS, type Deps } from '../../infra/deps';

const toView = (promo: PromoCode): PromoView => ({
  id: promo.id,
  code: promo.code,
  courseId: promo.courseId,
  discount: discountOf(promo),
  validFrom: promo.validFrom.toISOString(),
  validUntil: promo.validUntil.toISOString(),
  maxUses: promo.maxUses,
  usedCount: promo.usedCount,
  reservedCount: promo.reservedCount,
});

@Injectable()
export class PromosService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  async list(schoolId: string, query: { page: number; pageSize: number }) {
    const where = { schoolId };
    const [rows, total] = await Promise.all([
      this.deps.db.promoCode.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.deps.db.promoCode.count({ where }),
    ]);
    return { items: rows.map(toView), total, ...query };
  }

  async create(schoolId: string, input: CreatePromoInput) {
    const { discount, courseId } = input;
    if (courseId) {
      const count = await this.deps.db.course.count({ where: { id: courseId, schoolId } });
      if (count === 0) throw rejected('NOT_FOUND');
    }
    try {
      const promo = await this.deps.db.promoCode.create({
        data: {
          schoolId,
          code: input.code,
          courseId,
          discountKind: discount.kind,
          percent: discount.kind === 'percent' ? discount.percent : null,
          amountMinor: discount.kind === 'fixed' ? discount.amountMinor : null,
          currency: discount.kind === 'fixed' ? discount.currency : null,
          validFrom: new Date(input.validFrom),
          validUntil: new Date(input.validUntil),
          maxUses: input.maxUses,
          createdAt: await this.deps.time.now(),
        },
      });
      return toView(promo);
    } catch (error) {
      if (isUniqueViolation(error)) throw apiError('CONFLICT', 'This code already exists');
      throw error;
    }
  }

  async update(schoolId: string, id: string, change: UpdatePromoInput) {
    return inTransaction(this.deps.db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM promo_codes WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
      const promo = await tx.promoCode.findFirst({ where: { id, schoolId } });
      if (!promo) throw rejected('NOT_FOUND');
      const maxUses = change.maxUses ?? promo.maxUses;
      if (maxUses < promo.usedCount + promo.reservedCount) {
        throw apiError('CONFLICT', 'More uses than that are already taken');
      }
      const validUntil = change.validUntil ? new Date(change.validUntil) : promo.validUntil;
      if (validUntil <= promo.validFrom) {
        throw apiError('VALIDATION_FAILED', 'Check the highlighted fields', [
          { path: 'validUntil', message: 'The end must be after the start' },
        ]);
      }
      return toView(await tx.promoCode.update({ where: { id }, data: { maxUses, validUntil } }));
    });
  }
}
