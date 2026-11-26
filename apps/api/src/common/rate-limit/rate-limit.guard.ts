import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request, type Response } from 'express';
import { DEPS, type Deps } from '../../infra/deps';
import { apiError } from '../errors/api-error';
import { clientIp, createProxyList } from '../http/client-ip';
import { consume, type Verdict } from './limiter';
import { limitsFor, type LimitScope } from './limits';

const SCOPE = 'rate-limit:scope';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(DEPS) private readonly deps: Deps,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { env, redis, logger } = this.deps;
    if (!env.RATE_LIMIT_ENABLED) return true;
    const scope = this.reflector.get<LimitScope>(SCOPE, context.getHandler());
    const request = context.switchToHttp().getRequest<Request>();
    const ip = clientIp(
      request.socket.remoteAddress,
      request.headers['x-real-ip'],
      createProxyList(env.TRUSTED_PROXY_CIDRS),
    );
    const body = request.body as { email?: unknown } | undefined;
    for (const limit of limitsFor(scope, { ip, email: body?.email }, env)) {
      let verdict: Verdict;
      try {
        verdict = await consume(redis, limit);
      } catch (error) {
        logger.warn(
          { scope, mode: env.RATE_LIMIT_FAIL_MODE, error: String(error) },
          'rate limiter unavailable',
        );
        if (env.RATE_LIMIT_FAIL_MODE === 'open') return true;
        throw apiError('SERVICE_UNAVAILABLE', 'Try again shortly');
      }
      if (!verdict.allowed) {
        context
          .switchToHttp()
          .getResponse<Response>()
          .setHeader('Retry-After', String(verdict.retryAfterSec));
        throw apiError('RATE_LIMITED', 'Too many attempts. Try again later.');
      }
    }
    return true;
  }
}

export const RateLimit = (scope: LimitScope) =>
  applyDecorators(SetMetadata(SCOPE, scope), UseGuards(RateLimitGuard));
