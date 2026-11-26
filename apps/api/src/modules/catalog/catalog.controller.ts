import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  catalogPageSchema,
  catalogQuerySchema,
  courseDetailSchema,
  directionsSchema,
} from '@school/shared/schemas/catalog';
import { idParamSchema } from '@school/shared/schemas/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { Public } from '../../common/auth/decorators';
import { CatalogService } from './catalog.service';

class IdParamDto extends createZodDto(idParamSchema) {}
class CatalogQueryDto extends createZodDto(catalogQuerySchema) {}
class CatalogPageDto extends createZodDto(catalogPageSchema) {}
class DirectionsDto extends createZodDto(directionsSchema) {}
class CourseDetailDto extends createZodDto(courseDetailSchema) {}

@ApiTags('catalog')
@Public()
@Controller('catalog')
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get('cohorts')
  @ZodResponse({ status: 200, type: CatalogPageDto })
  search(@Query() query: CatalogQueryDto) {
    return this.catalog.search(query);
  }

  @Get('directions')
  @ZodResponse({ status: 200, type: DirectionsDto })
  directions() {
    return this.catalog.directions();
  }

  @Get('courses/:id')
  @ZodResponse({ status: 200, type: CourseDetailDto })
  course(@Param() params: IdParamDto) {
    return this.catalog.course(params.id);
  }
}
