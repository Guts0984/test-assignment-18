import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { reportQuerySchema, reportSchema } from '@school/shared/schemas/report';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { type Principal, schoolOf } from '../../common/auth/principal';
import { ReportsService } from './reports.service';

class ReportQueryDto extends createZodDto(reportQuerySchema) {}
class ReportDto extends createZodDto(reportSchema) {}

@ApiTags('manager')
@Roles('manager')
@Controller('manager/report')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Get()
  @ZodResponse({ status: 200, type: ReportDto })
  report(@CurrentUser() user: Principal, @Query() query: ReportQueryDto) {
    return this.reports.report(schoolOf(user), query);
  }
}
