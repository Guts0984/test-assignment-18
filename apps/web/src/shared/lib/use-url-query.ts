'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { readQuery, toSearch } from './query-string';
import { usePath, useSearchText } from './use-route';

/**
 * Filter state kept in the address bar. Every change is a history entry, so reload keeps the
 * filters and Back restores the previous ones.
 */
export const useUrlQuery = <K extends string>(keys: readonly K[]) => {
  const router = useRouter();
  const pathname = usePath();
  const search = useSearchText();
  const query = useMemo(() => readQuery(search, keys), [search, keys]);
  const setQuery = useCallback(
    (values: Readonly<Record<string, string | number | undefined>>) => {
      router.push(`${pathname}${toSearch(values)}`, { scroll: false });
    },
    [router, pathname],
  );
  return [query, setQuery] as const;
};
