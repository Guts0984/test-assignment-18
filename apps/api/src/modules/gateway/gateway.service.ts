import { Inject, Injectable } from '@nestjs/common';
import { seal } from '@school/gateway/secret-box';
import { type GatewayConfigInput } from '@school/shared/schemas/gateway';
import { DEPS, type Deps } from '../../infra/deps';

@Injectable()
export class GatewayService {
  constructor(@Inject(DEPS) private readonly deps: Deps) {}

  async get(schoolId: string) {
    const config = await this.deps.db.gatewayConfig.findUnique({ where: { schoolId } });
    return {
      configured: config !== null,
      baseUrl: config?.baseUrl ?? null,
      keyLast4: config?.keyLast4 ?? null,
      updatedAt: config?.updatedAt.toISOString() ?? null,
    };
  }

  async set(schoolId: string, input: GatewayConfigInput) {
    const data = {
      baseUrl: input.baseUrl,
      keyCiphertext: seal(input.key, this.deps.env.GATEWAY_ENCRYPTION_KEY),
      keyLast4: input.key.slice(-4),
      updatedAt: await this.deps.time.now(),
    };
    await this.deps.db.gatewayConfig.upsert({
      where: { schoolId },
      create: { schoolId, ...data },
      update: data,
    });
    return this.get(schoolId);
  }
}
