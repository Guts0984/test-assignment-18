import { seal } from '@school/gateway/secret-box';
import { type Tx } from '../src/client';
import { type SeedOptions } from './run';

export const seedGateways = async (
  tx: Tx,
  gateway: NonNullable<SeedOptions['gateway']>,
  now: Date,
): Promise<void> => {
  const schools = await tx.school.findMany({ select: { id: true } });
  await tx.gatewayConfig.createMany({
    data: schools.map((school) => ({
      schoolId: school.id,
      baseUrl: gateway.baseUrl,
      keyCiphertext: seal(gateway.key, gateway.encryptionKey),
      keyLast4: gateway.key.slice(-4),
      updatedAt: now,
    })),
  });
};
