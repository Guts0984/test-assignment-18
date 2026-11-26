import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../../common/auth/decorators';
import { DEPS, type Deps } from '../../infra/deps';

class HealthDto extends createZodDto(z.object({ status: z.literal('ok') })) {}

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  /** Postgres is required to serve requests; Redis is not. */
  @Get()
  @ZodResponse({ status: 200, type: HealthDto })
  async check() {
    await this.deps.db.$queryRaw`SELECT 1`;
    return { status: 'ok' as const };
  }
}
