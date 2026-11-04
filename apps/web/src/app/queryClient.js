import { QueryClient } from '@tanstack/react-query';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Don't retry client errors (validation, auth, not found) — only transient failures.
        retry: (count, error) => (error?.status >= 400 && error?.status < 500 ? false : count < 2),
      },
      mutations: { retry: false },
    },
  });
}
