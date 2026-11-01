import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Module-level singleton so non-React code (e.g. auth store on login/logout)
// can clear cached data when the tenant/org changes.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/** Clear all cached queries — called when switching org (login/logout). */
export function resetQueryCache() {
  queryClient.clear();
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
