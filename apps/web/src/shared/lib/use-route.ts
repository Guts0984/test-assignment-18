'use client';

import { useParams, usePathname, useSearchParams } from 'next/navigation';

// The `pages` folder that keeps Next away from `src/pages` also makes Next type these hooks as
// possibly null, so the null cases are settled once, here.

export const useRouteParam = (name: string): string => {
  const value = useParams<Record<string, string>>()?.[name];
  return typeof value === 'string' ? value : '';
};

export const usePath = (): string => usePathname() ?? '/';

export const useSearchText = (): string => useSearchParams()?.toString() ?? '';
