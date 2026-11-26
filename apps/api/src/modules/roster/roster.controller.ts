import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { idParamSchema, idSchema } from '@school/shared/schemas/common';
import {
  changeCapacitySchema,
  cohortStudentPageSchema,
  cohortWaitlistSchema,
  excludeSchema,
  moneyPageSchema,
  studentQuerySchema,
  studentSearchPageSchema,
  studentSearchSchema,
  transferSchema,
} from '@school/shared/schemas/enrollment';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { type Principal, schoolOf } from '../../common/auth/principal';
import { RosterService } from './roster.service';

class IdParamDto extends createZodDto(idParamSchema) {}
class StudentQueryDto extends createZodDto(studentQuerySchema) {}
class PageQueryDto extends createZodDto(studentQuerySchema.omit({ q: true })) {}
class SearchQueryDto extends createZodDto(studentSearchSchema) {}
class StudentPageDto extends createZodDto(cohortStudentPageSchema) {}
class CohortWaitlistDto extends createZodDto(cohortWaitlistSchema) {}
class MoneyPageDto extends createZodDto(moneyPageSchema) {}
class SearchPageDto extends createZodDto(studentSearchPageSchema) {}
class CapacityDto extends createZodDto(changeCapacitySchema) {}
class TransferDto extends createZodDto(transferSchema) {}
class ExcludeDto extends createZodDto(excludeSchema) {}
class TransferResultDto extends createZodDto(
  z.object({ enrollmentId: idSchema, surchargeMinor: z.number().int() }),
) {}

@ApiTags('manager')
@Roles('manager')
@Controller('manager')
export class RosterController {
  constructor(@Inject(RosterService) private readonly roster: RosterService) {}

  @Get('students')
  @ZodResponse({ status: 200, type: SearchPageDto })
  search(@CurrentUser() user: Principal, @Query() query: SearchQueryDto) {
    return this.roster.search(schoolOf(user), query);
  }

  @Get('cohorts/:id/students')
  @ZodResponse({ status: 200, type: StudentPageDto })
  students(
    @CurrentUser() user: Principal,
    @Param() params: IdParamDto,
    @Query() query: StudentQueryDto,
  ) {
    return this.roster.students(schoolOf(user), params.id, query);
  }

  @Get('cohorts/:id/waitlist')
  @ZodResponse({ status: 200, type: CohortWaitlistDto })
  waitlist(@CurrentUser() user: Principal, @Param() params: IdParamDto) {
    return this.roster.waitlist(schoolOf(user), params.id);
  }

  @Get('cohorts/:id/payments')
  @ZodResponse({ status: 200, type: MoneyPageDto })
  payments(
    @CurrentUser() user: Principal,
    @Param() params: IdParamDto,
    @Query() query: PageQueryDto,
  ) {
    return this.roster.payments(schoolOf(user), params.id, query);
  }

  @Patch('cohorts/:id/capacity')
  @HttpCode(204)
  async capacity(
    @CurrentUser() user: Principal,
    @Param() params: IdParamDto,
    @Body() body: CapacityDto,
  ) {
    await this.roster.capacity(user, params.id, body.capacity);
  }

  @Post('enrollments/:id/transfer')
  @ZodResponse({ status: 200, type: TransferResultDto })
  transfer(@CurrentUser() user: Principal, @Param() params: IdParamDto, @Body() body: TransferDto) {
    return this.roster.transfer(user, params.id, body.targetCohortId);
  }

  @Post('enrollments/:id/exclude')
  @HttpCode(204)
  async exclude(
    @CurrentUser() user: Principal,
    @Param() params: IdParamDto,
    @Body() body: ExcludeDto,
  ) {
    await this.roster.exclude(user, params.id, body.refundPolicy);
  }
}
