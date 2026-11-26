import { Controller, Delete, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { idParamSchema } from '@school/shared/schemas/common';
import { waitlistListSchema } from '@school/shared/schemas/enrollment';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { type Principal } from '../../common/auth/principal';
import { WaitlistService } from './waitlist.service';

class IdParamDto extends createZodDto(idParamSchema) {}
class WaitlistDto extends createZodDto(waitlistListSchema) {}

@ApiTags('waitlist')
@Roles('student')
@Controller('waitlist')
export class WaitlistController {
  constructor(@Inject(WaitlistService) private readonly waitlist: WaitlistService) {}

  @Get()
  @ZodResponse({ status: 200, type: WaitlistDto })
  list(@CurrentUser() user: Principal) {
    return this.waitlist.list(user.id);
  }

  @Post(':id')
  @ZodResponse({ status: 201, type: WaitlistDto })
  join(@CurrentUser() user: Principal, @Param() params: IdParamDto) {
    return this.waitlist.join(user.id, params.id);
  }

  @Delete(':id')
  @ZodResponse({ status: 200, type: WaitlistDto })
  leave(@CurrentUser() user: Principal, @Param() params: IdParamDto) {
    return this.waitlist.leave(user.id, params.id);
  }
}
