import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiErrorSchema } from '@school/shared/errors/api-error';
import { idParamSchema } from '@school/shared/schemas/common';
import {
  applyPromoSchema,
  checkoutSchema,
  enrollmentListSchema,
  enrollmentSchema,
  holdSeatSchema,
  refundPreviewSchema,
  transferOptionsSchema,
  transferSchema,
} from '@school/shared/schemas/enrollment';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { type Principal } from '../../common/auth/principal';
import { CheckoutService } from './checkout.service';
import { EnrollmentsService } from './enrollments.service';

class IdParamDto extends createZodDto(idParamSchema) {}
class HoldSeatDto extends createZodDto(holdSeatSchema) {}
class ApplyPromoDto extends createZodDto(applyPromoSchema) {}
class TransferDto extends createZodDto(transferSchema) {}
class EnrollmentDto extends createZodDto(enrollmentSchema) {}
/** A hold stands even when its promo code cannot be applied; the reason is reported. */
class HeldDto extends createZodDto(
  enrollmentSchema.extend({
    promoError: apiErrorSchema.pick({ code: true, message: true }).nullable(),
  }),
) {}
class EnrollmentListDto extends createZodDto(enrollmentListSchema) {}
class RefundPreviewDto extends createZodDto(refundPreviewSchema) {}
class TransferOptionsDto extends createZodDto(transferOptionsSchema) {}
class CheckoutDto extends createZodDto(checkoutSchema) {}

@ApiTags('enrollments')
@Roles('student')
@Controller('enrollments')
export class EnrollmentsController {
  constructor(
    @Inject(EnrollmentsService) private readonly enrollments: EnrollmentsService,
    @Inject(CheckoutService) private readonly payments: CheckoutService,
  ) {}

  @Get()
  @ZodResponse({ status: 200, type: EnrollmentListDto })
  list(@CurrentUser() user: Principal) {
    return this.enrollments.list(user.id);
  }

  @Post()
  @ZodResponse({ status: 201, type: HeldDto })
  hold(@CurrentUser() user: Principal, @Body() body: HoldSeatDto) {
    return this.enrollments.hold(user.id, body);
  }

  @Get(':id')
  @ZodResponse({ status: 200, type: EnrollmentDto })
  get(@CurrentUser() user: Principal, @Param() params: IdParamDto) {
    return this.enrollments.get(user.id, params.id);
  }

  @Post(':id/promo')
  @HttpCode(200)
  @ZodResponse({ status: 200, type: EnrollmentDto })
  applyPromo(
    @CurrentUser() user: Principal,
    @Param() params: IdParamDto,
    @Body() body: ApplyPromoDto,
  ) {
    return this.enrollments.applyPromo(user.id, params.id, body.code);
  }

  @Post(':id/checkout')
  @ZodResponse({ status: 200, type: CheckoutDto })
  checkout(@CurrentUser() user: Principal, @Param() params: IdParamDto) {
    return this.payments.checkout(user.id, params.id);
  }

  @Get(':id/refund-preview')
  @ZodResponse({ status: 200, type: RefundPreviewDto })
  refundPreview(@CurrentUser() user: Principal, @Param() params: IdParamDto) {
    return this.enrollments.refundPreview(user.id, params.id);
  }

  @Post(':id/cancel')
  @ZodResponse({ status: 200, type: EnrollmentDto })
  cancel(@CurrentUser() user: Principal, @Param() params: IdParamDto) {
    return this.enrollments.cancel(user.id, params.id);
  }

  @Get(':id/transfer-options')
  @ZodResponse({ status: 200, type: TransferOptionsDto })
  transferOptions(@CurrentUser() user: Principal, @Param() params: IdParamDto) {
    return this.enrollments.transferOptions(user.id, params.id);
  }

  @Post(':id/transfer')
  @ZodResponse({ status: 200, type: EnrollmentDto })
  transfer(@CurrentUser() user: Principal, @Param() params: IdParamDto, @Body() body: TransferDto) {
    return this.enrollments.transfer(user.id, params.id, body.targetCohortId);
  }
}
