import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { idParamSchema } from '@school/shared/schemas/common';
import {
  createPromoSchema,
  promoPageSchema,
  promoQuerySchema,
  promoSchema,
  updatePromoSchema,
} from '@school/shared/schemas/promo';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { type Principal, schoolOf } from '../../common/auth/principal';
import { PromosService } from './promos.service';

class IdParamDto extends createZodDto(idParamSchema) {}
class PromoQueryDto extends createZodDto(promoQuerySchema) {}
class CreatePromoDto extends createZodDto(createPromoSchema) {}
class UpdatePromoDto extends createZodDto(updatePromoSchema) {}
class PromoDto extends createZodDto(promoSchema) {}
class PromoPageDto extends createZodDto(promoPageSchema) {}

@ApiTags('manager')
@Roles('manager')
@Controller('manager/promos')
export class PromosController {
  constructor(@Inject(PromosService) private readonly promos: PromosService) {}

  @Get()
  @ZodResponse({ status: 200, type: PromoPageDto })
  list(@CurrentUser() user: Principal, @Query() query: PromoQueryDto) {
    return this.promos.list(schoolOf(user), query);
  }

  @Post()
  @ZodResponse({ status: 201, type: PromoDto })
  create(@CurrentUser() user: Principal, @Body() body: CreatePromoDto) {
    return this.promos.create(schoolOf(user), body);
  }

  @Patch(':id')
  @ZodResponse({ status: 200, type: PromoDto })
  update(
    @CurrentUser() user: Principal,
    @Param() params: IdParamDto,
    @Body() body: UpdatePromoDto,
  ) {
    return this.promos.update(schoolOf(user), params.id, body);
  }
}
