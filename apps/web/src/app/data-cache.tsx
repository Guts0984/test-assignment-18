'use client';

import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

const createClient = (): QueryClient => {
  const client: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 5_000 } },
    // Any change may affect any view, so views are refreshed after every mutation.
    mutationCache: new MutationCache({
      onSettled: () => {
        void client.invalidateQueries();
      },
    }),
  });
  return client;
};

export const Providers = ({ children }: { children: ReactNode }) => {
  const [client] = useState(createClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};
