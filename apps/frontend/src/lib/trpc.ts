import { createTRPCReact } from '@trpc/react-query'
import { httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../../../backend/src/router.js'
import { createBoundedFetch } from './boundedFetch.js'

export const trpc = createTRPCReact<AppRouter>()
const boundedFetch = createBoundedFetch()

export function createTrpcClient(getToken: () => string | null) {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: '/api/trpc',
        fetch: boundedFetch,
        headers: () => {
          const token = getToken()
          return token ? { authorization: `Bearer ${token}` } : {}
        },
      }),
    ],
  })
}
