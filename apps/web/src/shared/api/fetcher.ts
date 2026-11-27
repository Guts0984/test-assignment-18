import { apiErrorSchema, type ApiError } from '@school/shared/errors/api-error';
import { env } from '@/config/env';

export type ApiFailure = Error & ApiError;

const failure = async (response: Response): Promise<ApiFailure> => {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  const body: ApiError = parsed.success
    ? parsed.data
    : { code: 'SERVICE_UNAVAILABLE', message: 'The service is unavailable. Try again.' };
  return Object.assign(new Error(body.message), body);
};

const address = (path: string): string => path.replace(/^\/api/, env.NEXT_PUBLIC_API_BASE_URL);

let refreshing: Promise<boolean> | null = null;

/** One tab at a time: the next one then presents the token the previous one received. */
const acrossTabs = async (work: () => Promise<boolean>): Promise<boolean> =>
  'locks' in navigator ? await navigator.locks.request('session-refresh', work) : await work();

/**
 * Exchanges the refresh cookie once, however many requests ask at the same moment. Two
 * simultaneous exchanges would look like a stolen token and end the session.
 */
export const refreshSession = (): Promise<boolean> => {
  refreshing ??= acrossTabs(() =>
    fetch(address('/api/auth/refresh'), { method: 'POST' }).then((response) => response.ok),
  )
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
};

const NEVER_REFRESH = ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout'];

/** The transport of the generated client: cookies, one error format, silent token renewal. */
export const apiFetch = async <T>(path: string, options: RequestInit): Promise<T> => {
  const send = () => fetch(address(path), { ...options, credentials: 'same-origin' });
  let response = await send();
  const renewable = response.status === 401 && !NEVER_REFRESH.includes(path);
  if (renewable && (await refreshSession())) response = await send();
  if (!response.ok) throw await failure(response);
  return (response.status === 204 ? undefined : await response.json()) as T;
};
