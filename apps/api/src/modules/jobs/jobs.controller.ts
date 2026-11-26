import { Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { idParamSchema } from '@school/shared/schemas/common';
import { failedJobPageSchema, failedJobQuerySchema } from '@school/shared/schemas/jobs';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { type Principal, schoolOf } from '../../common/auth/principal';
import { JobsService } from './jobs.service';

class IdParamDto extends createZodDto(idParamSchema) {}
class FailedJobQueryDto extends createZodDto(failedJobQuerySchema) {}
class FailedJobPageDto extends createZodDto(failedJobPageSchema) {}

@ApiTags('manager')
@Roles('manager')
@Controller('manager/failed-jobs')
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}

  @Get()
  @ZodResponse({ status: 200, type: FailedJobPageDto })
  list(@CurrentUser() user: Principal, @Query() query: FailedJobQueryDto) {
    return this.jobs.list(schoolOf(user), query);
  }

  @Post(':id/retry')
  @HttpCode(204)
  async retry(@CurrentUser() user: Principal, @Param() params: IdParamDto) {
    await this.jobs.retry(schoolOf(user), params.id);
  }
}
