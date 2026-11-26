import { err, ok, type Result } from '@school/shared/result/result';
import {
  refundResultSchema,
  sessionSchema,
  type CreateSessionInput,
  type GatewayRefundInput,
} from '@school/shared/schemas/gateway-protocol';
import { type z } from 'zod';
import { sign, SIGNATURE_HEADER } from './signature';

export type GatewayFailure =
  | { readonly kind: 'unavailable'; readonly detail: string }
  | { readonly kind: 'rate_limited'; readonly retryAfterSec: number }
  | { readonly kind: 'rejected'; readonly status: number };

export type Gateway = {
  readonly baseUrl: string;
  readonly key: string;
  readonly timeoutMs: number;
};

const call = async <T>(
  gateway: Gateway,
  path: string,
  payload: unknown,
  schema: z.ZodType<T>,
): Promise<Result<T, GatewayFailure>> => {
  const body = JSON.stringify(payload);
  try {
    const response = await fetch(`${gateway.baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: sign(gateway.key, body, new Date()),
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(gateway.timeoutMs),
    });
    if (response.status === 429) {
      const retryAfterSec = Number(response.headers.get('retry-after') ?? 1) || 1;
      return err({ kind: 'rate_limited', retryAfterSec });
    }
    if (response.status >= 500) {
      return err({ kind: 'unavailable', detail: `status ${response.status}` });
    }
    if (!response.ok) return err({ kind: 'rejected', status: response.status });
    const parsed = schema.safeParse(await response.json());
    return parsed.success
      ? ok(parsed.data)
      : err({ kind: 'unavailable', detail: 'unreadable response' });
  } catch (error) {
    return err({ kind: 'unavailable', detail: error instanceof Error ? error.name : 'error' });
  }
};

export const createSession = (gateway: Gateway, input: CreateSessionInput) =>
  call(gateway, '/sessions', input, sessionSchema);

/** Safe to repeat: the payment system performs one refund per `refundId`. */
export const requestRefund = (gateway: Gateway, input: GatewayRefundInput) =>
  call(gateway, '/refunds', input, refundResultSchema);
