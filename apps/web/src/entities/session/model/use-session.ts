'use client';

import { useAuthMe } from '@/shared/api';

/** The signed-in account, `null` when signed out, `undefined` while unknown. */
export const useSession = () => {
  const query = useAuthMe({ query: { retry: false, staleTime: 60_000 } });
  if (query.isPending) return { account: undefined, query };
  return { account: query.error ? null : query.data, query };
};
