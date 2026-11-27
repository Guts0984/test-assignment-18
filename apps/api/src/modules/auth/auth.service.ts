import { Inject, Injectable } from '@nestjs/common';
import { isUniqueViolation } from '@school/db/errors';
import { hashPassword, verifyPassword } from '@school/db/password';
import { type LoginInput, type RegisterInput } from '@school/shared/schemas/auth';
import { signAccessToken } from '../../common/auth/access-token';
import { apiError } from '../../common/errors/api-error';
import { DEPS, type Deps } from '../../infra/deps';
import { toAccount } from './domain/account';
import { endSession, rotateSession, startSession } from './repo/refresh-tokens';

@Injectable()
export class AuthService {
  /** Verified when the address is unknown, so both failures cost the same time. */
  private readonly decoyHash = hashPassword('decoy-password-never-matches');

  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  async register(input: RegisterInput): Promise<void> {
    const { password, ...profile } = input;
    const passwordHash = await hashPassword(password);
    try {
      await this.deps.db.user.create({ data: { ...profile, passwordHash, role: 'student' } });
    } catch (error) {
      // A taken address answers like a new one, so registration cannot probe for accounts.
      if (!isUniqueViolation(error)) throw error;
    }
  }

  async login(input: LoginInput) {
    const user = await this.deps.db.user.findUnique({ where: { email: input.email } });
    const matches = await verifyPassword(
      user?.passwordHash ?? (await this.decoyHash),
      input.password,
    );
    if (!user || !matches || user.disabledAt) {
      throw apiError('INVALID_CREDENTIALS', 'The e-mail or password is wrong');
    }
    const { sessionId, token } = await startSession(this.deps.db, user.id, this.window());
    return {
      account: toAccount(user),
      refreshToken: token,
      accessToken: await this.sign(user.id, sessionId),
    };
  }

  async refresh(presented: string | undefined) {
    if (presented === undefined) throw apiError('UNAUTHENTICATED', 'Sign in to continue');
    const rotation = await rotateSession(this.deps.db, presented, this.window());
    if (!rotation.ok) {
      if (rotation.reason === 'reused') this.deps.realtime.endSession(rotation.sessionId);
      throw rotation.reason === 'reused'
        ? apiError('TOKEN_REUSED', 'This session was ended. Sign in again.')
        : apiError('UNAUTHENTICATED', 'Sign in to continue');
    }
    const user = await this.deps.db.user.findUniqueOrThrow({ where: { id: rotation.userId } });
    return {
      account: toAccount(user),
      refreshToken: rotation.token,
      accessToken: await this.sign(user.id, rotation.sessionId),
    };
  }

  async logout(presented: string | undefined): Promise<void> {
    if (presented === undefined) return;
    const sessionId = await endSession(this.deps.db, presented, new Date());
    if (sessionId !== undefined) this.deps.realtime.endSession(sessionId);
  }

  async account(userId: string) {
    return toAccount(await this.deps.db.user.findUniqueOrThrow({ where: { id: userId } }));
  }

  async updateProfile(userId: string, change: { readonly timeZone: string }) {
    return toAccount(await this.deps.db.user.update({ where: { id: userId }, data: change }));
  }

  private window() {
    return { now: new Date(), ttlSec: this.deps.env.REFRESH_TTL_SEC };
  }

  private sign(userId: string, sessionId: string): Promise<string> {
    const { JWT_ACCESS_SECRET: secret, JWT_ACCESS_TTL_SEC: ttlSec } = this.deps.env;
    return signAccessToken({ userId, sessionId }, { secret, ttlSec, now: new Date() });
  }
}
