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

// Keep visited encrypted data in the snapshot even after its screen unmounts.
queryClient.setQueryDefaults([['lists', 'list']], { gcTime: Infinity })
queryClient.setQueryDefaults([['tasks', 'list']], { gcTime: Infinity })
queryClient.setQueryDefaults(['notes'], { gcTime: Infinity })
