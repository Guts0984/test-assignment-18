import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { ROLES, type Role } from '@school/shared/status/actors';
import { type ApiRequest } from '../http/request';

export const IS_PUBLIC = 'auth:public';
export const ALLOWED_ROLES = 'auth:roles';

/** No credentials needed. Every other route requires a signed-in user with an allowed role. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: readonly Role[]) => SetMetadata(ALLOWED_ROLES, roles);
export const AnyRole = () => Roles(...ROLES);

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const { principal } = context.switchToHttp().getRequest<ApiRequest>();
  if (!principal) throw new Error('CurrentUser used on a route without authentication');
  return principal;
});
