import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { cabinetSchema } from '@school/shared/schemas/homework';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { type Principal } from '../../common/auth/principal';
import { CabinetService } from './cabinet.service';

class CabinetDto extends createZodDto(cabinetSchema) {}

@ApiTags('cabinet')
@Roles('student')
@Controller('cabinet')
export class CabinetController {
  constructor(@Inject(CabinetService) private readonly cabinet: CabinetService) {}

  @Get()
  @ZodResponse({ status: 200, type: CabinetDto })
  get(@CurrentUser() user: Principal) {
    return this.cabinet.get(user.id);
  }
}
