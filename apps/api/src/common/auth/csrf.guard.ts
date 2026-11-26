import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { type Request } from 'express';
import { DEPS, type Deps } from '../../infra/deps';
import { apiError } from '../errors/api-error';
import { isForgedRequest } from './origin';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const fetchSite = request.headers['sec-fetch-site'];
    const forged = isForgedRequest(
      {
        method: request.method,
        origin: request.headers.origin,
        fetchSite: typeof fetchSite === 'string' ? fetchSite : undefined,
      },
      this.deps.env.CORS_ORIGINS,
    );
    if (forged) throw apiError('CSRF_REJECTED', 'Cross-site requests are not allowed');
    return true;
  }
}
