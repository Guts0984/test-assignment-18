import { type ArgumentsHost, Catch, type ExceptionFilter, Inject } from '@nestjs/common';
import { type Response } from 'express';
import { DEPS, type Deps } from '../../infra/deps';
import { requestIdOf } from '../http/request';
import { renderError } from './error-body';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body, unexpected } = renderError(error);
    const requestId = requestIdOf(response);
    if (unexpected) {
      this.deps.logger.error(
        { requestId, error: error instanceof Error ? error.stack : String(error) },
        'unhandled error',
      );
    }
    response.status(status).json({ ...body, requestId });
  }
}
