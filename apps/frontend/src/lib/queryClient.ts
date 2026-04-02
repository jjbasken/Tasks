import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: 'always',
      // Serve cached data when offline instead of failing
      networkMode: 'offlineFirst',
    },
    mutations: {
      // Don't auto-retry mutations — we handle queuing ourselves
      networkMode: 'offlineFirst',
    },
  },
})
