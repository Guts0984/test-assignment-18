import { Body, Controller, Headers, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { SIGNATURE_HEADER } from '@school/gateway/signature';
import { idSchema } from '@school/shared/schemas/common';
import { notificationAckSchema } from '@school/shared/schemas/gateway-protocol';
import { type Request } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../../common/auth/decorators';
import { WebhookService } from './webhook.service';

/** Only what is needed to find the key; the whole body is checked after the signature. */
class NotificationDto extends createZodDto(
  z.looseObject({ eventId: z.string(), schoolId: idSchema, type: z.string() }),
) {}
class AckDto extends createZodDto(notificationAckSchema) {}

@ApiTags('payments')
@Public()
@Controller('payments')
export class WebhookController {
  constructor(@Inject(WebhookService) private readonly webhook: WebhookService) {}

  @Post('webhook')
  @HttpCode(200)
  @ApiHeader({ name: SIGNATURE_HEADER, required: true })
  @ZodResponse({ status: 200, type: AckDto })
  async receive(
    @Body() body: NotificationDto,
    @Headers(SIGNATURE_HEADER) signature: string | undefined,
    @Req() request: Request & { rawBody?: Buffer },
  ) {
    await this.webhook.receive({
      schoolId: body.schoolId,
      signature,
      rawBody: request.rawBody ?? Buffer.alloc(0),
    });
    return { received: true as const };
  }
}
