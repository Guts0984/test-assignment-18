import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { gatewayConfigInputSchema, gatewayConfigSchema } from '@school/shared/schemas/gateway';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { type Principal, schoolOf } from '../../common/auth/principal';
import { GatewayService } from './gateway.service';

class ConfigInputDto extends createZodDto(gatewayConfigInputSchema) {}
class ConfigDto extends createZodDto(gatewayConfigSchema) {}

@ApiTags('admin')
@Roles('admin')
@Controller('admin/gateway')
export class GatewayController {
  constructor(@Inject(GatewayService) private readonly gateway: GatewayService) {}

  @Get()
  @ZodResponse({ status: 200, type: ConfigDto })
  get(@CurrentUser() user: Principal) {
    return this.gateway.get(schoolOf(user));
  }

  @Put()
  @ZodResponse({ status: 200, type: ConfigDto })
  set(@CurrentUser() user: Principal, @Body() body: ConfigInputDto) {
    return this.gateway.set(schoolOf(user), body);
  }
}
