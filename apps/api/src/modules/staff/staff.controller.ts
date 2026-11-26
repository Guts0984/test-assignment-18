import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { idParamSchema } from '@school/shared/schemas/common';
import {
  createStaffSchema,
  staffListSchema,
  staffMemberSchema,
  updateStaffSchema,
} from '@school/shared/schemas/staff';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { type Principal, schoolOf } from '../../common/auth/principal';
import { StaffService } from './staff.service';

class IdParamDto extends createZodDto(idParamSchema) {}
class CreateStaffDto extends createZodDto(createStaffSchema) {}
class UpdateStaffDto extends createZodDto(updateStaffSchema) {}
class StaffMemberDto extends createZodDto(staffMemberSchema) {}
class StaffListDto extends createZodDto(staffListSchema) {}

@ApiTags('admin')
@Roles('admin')
@Controller('admin/staff')
export class StaffController {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}

  @Get()
  @ZodResponse({ status: 200, type: StaffListDto })
  list(@CurrentUser() user: Principal) {
    return this.staff.list(schoolOf(user));
  }

  @Post()
  @ZodResponse({ status: 201, type: StaffMemberDto })
  create(@CurrentUser() user: Principal, @Body() body: CreateStaffDto) {
    return this.staff.create(schoolOf(user), body);
  }

  @Patch(':id')
  @ZodResponse({ status: 200, type: StaffMemberDto })
  update(
    @CurrentUser() user: Principal,
    @Param() params: IdParamDto,
    @Body() body: UpdateStaffDto,
  ) {
    return this.staff.update(schoolOf(user), params.id, body);
  }
}
