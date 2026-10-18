import { createTRPCReact } from '@trpc/react-query'
import { httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../../../backend/src/router.js'

export const trpc = createTRPCReact<AppRouter>()

export function createTrpcClient(getToken: () => string | null) {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: '/api/trpc',
        fetch: (url, options) => fetch(url, {
          ...options,
          // A connected Wi-Fi network can still have no internet. Bound each
          // attempt so the replay loop can retry instead of hanging forever.
          signal: options?.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)])
            : AbortSignal.timeout(15_000),
        }),
        headers: () => {
          const token = getToken()
          return token ? { authorization: `Bearer ${token}` } : {}
        },
      }),
    ],
  })
}
