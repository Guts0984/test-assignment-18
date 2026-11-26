import { randomUUID } from 'node:crypto';
import { type Db, type Tx } from '@school/db/client';
import { inTransaction } from '@school/db/transaction';
import { hashRefreshToken, newRefreshToken } from '../domain/refresh-token';

type Window = { readonly now: Date; readonly ttlSec: number };

const insert = async (tx: Tx, userId: string, familyId: string, window: Window) => {
  const token = newRefreshToken();
  await tx.refreshToken.create({
    data: {
      userId,
      familyId,
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(window.now.getTime() + window.ttlSec * 1000),
    },
  });
  return token;
};

export const startSession = (db: Db, userId: string, window: Window): Promise<string> =>
  inTransaction(db, (tx) => insert(tx, userId, randomUUID(), window));

export type Rotation =
  | { readonly ok: true; readonly userId: string; readonly token: string }
  | { readonly ok: false; readonly reason: 'invalid' | 'reused' };

const revoke = (tx: Tx, familyId: string, now: Date) =>
  tx.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now } });

/**
 * Exchanges a refresh token for the next one. Presenting a token that was already exchanged
 * means a copy is in other hands, so the whole family is revoked.
 */
export const rotateSession = (db: Db, presented: string, window: Window): Promise<Rotation> =>
  inTransaction(db, async (tx): Promise<Rotation> => {
    const hash = hashRefreshToken(presented);
    await tx.$queryRaw`SELECT id FROM refresh_tokens WHERE token_hash = ${hash} FOR UPDATE`;
    const current = await tx.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    });
    if (!current) return { ok: false, reason: 'invalid' };
    if (current.rotatedAt) {
      await revoke(tx, current.familyId, window.now);
      return { ok: false, reason: 'reused' };
    }
    const dead = current.revokedAt || current.expiresAt <= window.now || current.user.disabledAt;
    if (dead) return { ok: false, reason: 'invalid' };
    await tx.refreshToken.update({ where: { id: current.id }, data: { rotatedAt: window.now } });
    const token = await insert(tx, current.userId, current.familyId, window);
    return { ok: true, userId: current.userId, token };
  });

export const endSession = (db: Db, presented: string, now: Date): Promise<void> =>
  inTransaction(db, async (tx) => {
    const current = await tx.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(presented) },
    });
    if (current) await revoke(tx, current.familyId, now);
  });
