import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { idParamSchema } from '@school/shared/schemas/common';
import {
  courseListQuerySchema,
  coursePageSchema,
  courseSchema,
  createCourseSchema,
  updateCourseSchema,
} from '@school/shared/schemas/manage';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { type Principal, schoolOf } from '../../common/auth/principal';
import { CoursesService } from './courses.service';

class IdParamDto extends createZodDto(idParamSchema) {}
class CourseListQueryDto extends createZodDto(courseListQuerySchema) {}
class CreateCourseDto extends createZodDto(createCourseSchema) {}
class UpdateCourseDto extends createZodDto(updateCourseSchema) {}
class CourseDto extends createZodDto(courseSchema) {}
class CoursePageDto extends createZodDto(coursePageSchema) {}

@ApiTags('manager')
@Roles('manager')
@Controller('manager/courses')
export class CoursesController {
  constructor(@Inject(CoursesService) private readonly courses: CoursesService) {}

  @Get()
  @ZodResponse({ status: 200, type: CoursePageDto })
  list(@CurrentUser() user: Principal, @Query() query: CourseListQueryDto) {
    return this.courses.list(schoolOf(user), query);
  }

  @Post()
  @ZodResponse({ status: 201, type: CourseDto })
  create(@CurrentUser() user: Principal, @Body() body: CreateCourseDto) {
    return this.courses.create(schoolOf(user), body);
  }

  @Patch(':id')
  @ZodResponse({ status: 200, type: CourseDto })
  update(
    @CurrentUser() user: Principal,
    @Param() params: IdParamDto,
    @Body() body: UpdateCourseDto,
  ) {
    return this.courses.update(schoolOf(user), params.id, body);
  }
}
