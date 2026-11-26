import { Body, Controller, Headers, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { setSharedTestTime } from '@school/db/time';
import { setTestClockSchema } from '@school/shared/schemas/test-control';
import { createZodDto } from 'nestjs-zod';
import { Public } from '../../common/auth/decorators';
import { secretEquals } from '../../common/auth/secret-equals';
import { apiError } from '../../common/errors/api-error';
import { DEPS, type Deps } from '../../infra/deps';

class SetClockDto extends createZodDto(setTestClockSchema) {}

/** Moves the shared clock. The module is registered only when the test clock is enabled. */
@ApiExcludeController()
@Public()
@Controller('__test')
export class TestControlController {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  @Post('clock')
  @HttpCode(200)
  async setClock(@Headers('x-test-token') token: string | undefined, @Body() body: SetClockDto) {
    if (!secretEquals(token ?? '', this.deps.env.TEST_CONTROL_TOKEN)) {
      throw apiError('UNAUTHENTICATED', 'Wrong test token');
    }
    await setSharedTestTime(this.deps.db, new Date(body.now));
    return { now: body.now };
  }
}
