import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiProduces, ApiTags } from '@nestjs/swagger';
import { idParamSchema } from '@school/shared/schemas/common';
import { submissionSchema, submitSchema } from '@school/shared/schemas/homework';
import { type Response } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { type Principal } from '../../common/auth/principal';
import { HomeworkService, type ReceivedFile } from './homework.service';

class IdParamDto extends createZodDto(idParamSchema) {}
class SubmitDto extends createZodDto(submitSchema) {}
class SubmissionDto extends createZodDto(submissionSchema) {}

@ApiTags('homework')
@Controller()
export class HomeworkController {
  constructor(@Inject(HomeworkService) private readonly homework: HomeworkService) {}

  /** Multipart: the answer text in `body` and an optional `file`. */
  @Roles('student')
  @Put('homework/:id/submission')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { body: { type: 'string' }, file: { type: 'string', format: 'binary' } },
    },
  })
  @ZodResponse({ status: 200, type: SubmissionDto })
  submit(
    @CurrentUser() user: Principal,
    @Param() params: IdParamDto,
    @Body() input: SubmitDto,
    @UploadedFile() file: ReceivedFile | undefined,
  ) {
    return this.homework.submit(user.id, params.id, input.body, file);
  }

  @Roles('student', 'mentor', 'manager')
  @Get('submissions/:id/file')
  @ApiProduces('application/octet-stream')
  async file(
    @CurrentUser() user: Principal,
    @Param() params: IdParamDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.homework.file(user, params.id);
    // Always a download, never rendered by the browser.
    response.attachment(file.fileName);
    response.type('application/octet-stream');
    return new StreamableFile(file.content);
  }
}
