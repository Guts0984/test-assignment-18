import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { idParamSchema } from '@school/shared/schemas/common';
import {
  cohortListQuerySchema,
  createCohortSchema,
  managerCohortDetailSchema,
  managerCohortPageSchema,
  mentorOptionsSchema,
  rescheduleLessonSchema,
  updateCohortSchema,
} from '@school/shared/schemas/manage';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { type Principal, schoolOf } from '../../common/auth/principal';
import { CohortsService } from './cohorts.service';

class IdParamDto extends createZodDto(idParamSchema) {}
class CohortListQueryDto extends createZodDto(cohortListQuerySchema) {}
class CreateCohortDto extends createZodDto(createCohortSchema) {}
class UpdateCohortDto extends createZodDto(updateCohortSchema) {}
class RescheduleDto extends createZodDto(rescheduleLessonSchema) {}
class CohortDetailDto extends createZodDto(managerCohortDetailSchema) {}
class CohortPageDto extends createZodDto(managerCohortPageSchema) {}
class MentorOptionsDto extends createZodDto(mentorOptionsSchema) {}

@ApiTags('manager')
@Roles('manager')
@Controller('manager')
export class CohortsController {
  constructor(@Inject(CohortsService) private readonly cohorts: CohortsService) {}

  @Get('mentors')
  @ZodResponse({ status: 200, type: MentorOptionsDto })
  mentors(@CurrentUser() user: Principal) {
    return this.cohorts.mentors(schoolOf(user));
  }

  @Get('cohorts')
  @ZodResponse({ status: 200, type: CohortPageDto })
  list(@CurrentUser() user: Principal, @Query() query: CohortListQueryDto) {
    return this.cohorts.list(schoolOf(user), query);
  }

  @Post('cohorts')
  @ZodResponse({ status: 201, type: CohortDetailDto })
  create(@CurrentUser() user: Principal, @Body() body: CreateCohortDto) {
    return this.cohorts.create(user, body);
  }

  @Get('cohorts/:id')
  @ZodResponse({ status: 200, type: CohortDetailDto })
  get(@CurrentUser() user: Principal, @Param() params: IdParamDto) {
    return this.cohorts.get(schoolOf(user), params.id);
  }

  @Patch('cohorts/:id')
  @ZodResponse({ status: 200, type: CohortDetailDto })
  update(
    @CurrentUser() user: Principal,
    @Param() params: IdParamDto,
    @Body() body: UpdateCohortDto,
  ) {
    return this.cohorts.update(schoolOf(user), params.id, body);
  }

  @Patch('lessons/:id')
  @ZodResponse({ status: 200, type: CohortDetailDto })
  reschedule(
    @CurrentUser() user: Principal,
    @Param() params: IdParamDto,
    @Body() body: RescheduleDto,
  ) {
    return this.cohorts.reschedule(schoolOf(user), params.id, body);
  }
}
