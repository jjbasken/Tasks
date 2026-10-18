import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function worker(options: { failInstall?: boolean } = {}) {
  const handlers: Record<string, (event: any) => void> = {}
  const deleted: string[] = []
  const network: string[] = []
  const requests: string[] = []
  const skipped: boolean[] = []
  const cache = {
    addAll: async (items: Request[]) => {
      requests.push(...items.map(item => item.url))
      if (options.failInstall) throw new Error('disconnected during install')
    },
    match: async (path: string) => path === '/index.html' ? new Response('cached app') : undefined,
  }
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    self: { location: { origin: 'https://tasks.test' }, clients: { claim: async () => {} }, skipWaiting: () => { skipped.push(true) }, addEventListener: (name: string, fn: any) => { handlers[name] = fn } },
    caches: { open: async () => cache, keys: async () => ['tasks-v1', 'tasks-shell-old', 'other-app'], delete: async (key: string) => { deleted.push(key) } },
    URL, Request: class extends Request { constructor(url: string, init: RequestInit) { super(new URL(url, 'https://tasks.test'), init) } },
    fetch: async (request: Request) => { network.push(request.url); throw new Error('offline') },
  })
  return { handlers, deleted, network, requests, skipped }
}

it('waits for the complete offline shell and rejects an interrupted install', async () => {
  const instance = worker()
  let lifetime!: Promise<void>
  instance.handlers.install({ waitUntil: (promise: Promise<void>) => { lifetime = promise } })
  await lifetime
  expect(instance.requests).toContain('https://tasks.test/index.html')
  const failing = worker({ failInstall: true })
  failing.handlers.install({ waitUntil: (promise: Promise<void>) => { lifetime = promise } })
  await expect(lifetime).rejects.toThrow('disconnected')
})

it('opens an unvisited deep link offline without starting a network request', async () => {
  const instance = worker()
  let response!: Promise<Response>
  instance.handlers.fetch({ request: { url: 'https://tasks.test/notes?listId=123', method: 'GET', mode: 'navigate' }, respondWith: (promise: Promise<Response>) => { response = promise } })
  expect(await (await response).text()).toBe('cached app')
  expect(instance.network).toEqual([])
})

it('leaves API, external, and write requests alone and cleans only its own caches', async () => {
  const instance = worker()
  for (const [url, method] of [['https://tasks.test/api/trpc', 'GET'], ['https://tasks.test/api', 'GET'], ['https://external.test/index.html', 'GET'], ['https://tasks.test/notes', 'POST']]) {
    instance.handlers.fetch({ request: { url, method, mode: 'navigate' }, respondWith: () => { throw new Error('must not intercept') } })
  }
  let lifetime!: Promise<void>
  instance.handlers.activate({ waitUntil: (promise: Promise<void>) => { lifetime = promise } })
  await lifetime
  expect(instance.deleted.sort()).toEqual(['tasks-shell-old', 'tasks-v1'])
})

it('activates a waiting update only when the page asks for it', () => {
  const instance = worker()
  const origin = 'https://tasks.test'
  instance.handlers.message({ origin, data: { type: 'other' } })
  instance.handlers.message({ origin, data: null })
  instance.handlers.message({ origin: 'https://evil.test', data: { type: 'SKIP_WAITING' } })
  expect(instance.skipped).toEqual([])
  instance.handlers.message({ origin, data: { type: 'SKIP_WAITING' } })
  expect(instance.skipped).toEqual([true])
})
