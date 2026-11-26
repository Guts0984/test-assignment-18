import { Controller, Get, Inject, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  certificateListSchema,
  verifiedSchema,
  verifyParamSchema,
} from '@school/shared/schemas/certificate';
import { idParamSchema } from '@school/shared/schemas/common';
import { type Response } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import { type Principal } from '../../common/auth/principal';
import { CertificatesService } from './certificates.service';

class IdParamDto extends createZodDto(idParamSchema) {}
class TokenParamDto extends createZodDto(verifyParamSchema) {}
class CertificateListDto extends createZodDto(certificateListSchema) {}
class VerifiedDto extends createZodDto(verifiedSchema) {}

@ApiTags('certificates')
@Controller()
export class CertificatesController {
  constructor(@Inject(CertificatesService) private readonly certificates: CertificatesService) {}

  @Roles('student')
  @Get('certificates')
  @ZodResponse({ status: 200, type: CertificateListDto })
  list(@CurrentUser() user: Principal) {
    return this.certificates.list(user.id);
  }

  @Roles('student')
  @Get('certificates/:id/pdf')
  @ApiProduces('application/pdf')
  async pdf(
    @CurrentUser() user: Principal,
    @Param() params: IdParamDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { content, number } = await this.certificates.pdf(user.id, params.id);
    response.attachment(`certificate-${number}.pdf`);
    return new StreamableFile(content);
  }

  @Public()
  @Get('verify/:token')
  @ZodResponse({ status: 200, type: VerifiedDto })
  verify(@Param() params: TokenParamDto) {
    return this.certificates.verify(params.token);
  }
}
