import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  acceptedSchema,
  accountSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '@school/shared/schemas/auth';
import { type Request, type Response } from 'express';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { AnyRole, CurrentUser, Public } from '../../common/auth/decorators';
import { type Principal } from '../../common/auth/principal';
import { REFRESH_COOKIE } from '../../common/auth/session';
import { readCookie } from '../../common/http/request';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard';
import { DEPS, type Deps } from '../../infra/deps';
import { AuthService } from './auth.service';
import { clearSessionCookies, setSessionCookies } from './cookies';

class RegisterDto extends createZodDto(registerSchema) {}
class LoginDto extends createZodDto(loginSchema) {}
class UpdateProfileDto extends createZodDto(updateProfileSchema) {}
class AccountDto extends createZodDto(accountSchema) {}
class AcceptedDto extends createZodDto(acceptedSchema) {}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DEPS) private readonly deps: Deps,
  ) {}

  @Public()
  @RateLimit('register')
  @Post('register')
  @ZodResponse({ status: 202, type: AcceptedDto })
  async register(@Body() body: RegisterDto) {
    await this.auth.register(body);
    return { status: 'accepted' as const };
  }

  @Public()
  @RateLimit('login')
  @Post('login')
  @ZodResponse({ status: 200, type: AccountDto })
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.auth.login(body);
    setSessionCookies(response, this.deps.env, session);
    return session.account;
  }

  @Public()
  @Post('refresh')
  @ZodResponse({ status: 200, type: AccountDto })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const session = await this.auth.refresh(readCookie(request.headers.cookie, REFRESH_COOKIE));
    setSessionCookies(response, this.deps.env, session);
    return session.account;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(readCookie(request.headers.cookie, REFRESH_COOKIE));
    clearSessionCookies(response, this.deps.env);
  }

  @AnyRole()
  @Get('me')
  @ZodResponse({ status: 200, type: AccountDto })
  me(@CurrentUser() user: Principal) {
    return this.auth.account(user.id);
  }

  @AnyRole()
  @Patch('me')
  @ZodResponse({ status: 200, type: AccountDto })
  update(@CurrentUser() user: Principal, @Body() body: UpdateProfileDto) {
    return this.auth.updateProfile(user.id, body);
  }
}
