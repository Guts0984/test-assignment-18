import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Role } from '@school/shared/status/actors';
import { DEPS, type Deps } from '../../infra/deps';
import { apiError } from '../errors/api-error';
import { type ApiRequest, readCookie } from '../http/request';
import { ALLOWED_ROLES, IS_PUBLIC } from './decorators';
import { ACCESS_COOKIE, authenticate } from './session';

/** Default deny: a route is closed unless it is public or lists the caller's role. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(DEPS) private readonly deps: Deps,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const principal = await authenticate(
      { db: this.deps.db, secret: this.deps.env.JWT_ACCESS_SECRET },
      readCookie(request.headers.cookie, ACCESS_COOKIE),
    );
    if (!principal) throw apiError('UNAUTHENTICATED', 'Sign in to continue');
    const roles = this.reflector.getAllAndOverride<readonly Role[] | undefined>(
      ALLOWED_ROLES,
      targets,
    );
    if (!roles?.includes(principal.role)) throw apiError('FORBIDDEN', 'You cannot do this');
    request.principal = principal;
    return true;
  }
}
