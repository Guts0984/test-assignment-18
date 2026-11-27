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
import { MultipartOnlyInterceptor } from '../../common/http/multipart-only';
import { HomeworkService, type ReceivedFile } from './homework.service';

class IdParamDto extends createZodDto(idParamSchema) {}
class SubmitDto extends createZodDto(submitSchema) {}
class SubmissionDto extends createZodDto(submissionSchema) {}

@ApiTags('homework')
@Controller()
export class HomeworkController {
  constructor(@Inject(HomeworkService) private readonly homework: HomeworkService) {}

  /** Multipart: the answer in `body`, an optional `file`, and `removeFile` to drop the old one. */
  @Roles('student')
  @Put('homework/:id/submission')
  // The form check comes first: any other body would read as an empty answer.
  @UseInterceptors(MultipartOnlyInterceptor, FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        body: { type: 'string' },
        file: { type: 'string', format: 'binary' },
        removeFile: { type: 'string', enum: ['true', 'false'] },
      },
    },
  })
  @ZodResponse({ status: 200, type: SubmissionDto })
  submit(
    @CurrentUser() user: Principal,
    @Param() params: IdParamDto,
    @Body() input: SubmitDto,
    @UploadedFile() file: ReceivedFile | undefined,
  ) {
    const answer = { body: input.body, removeFile: input.removeFile === 'true' };
    return this.homework.submit(user.id, params.id, answer, file);
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
