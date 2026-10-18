import { expect, it } from 'bun:test'
import { createBoundedFetch } from '../src/lib/boundedFetch.js'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** A server that answers after `headerDelay` and then sends `chunks` every `chunkDelay`. */
function server(options: { headerDelay?: number; chunkDelay?: number; chunks?: number; stallAfter?: number } = {}) {
  const fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init!.signal!
    const aborted = new Promise<never>((_, reject) => {
      if (signal.aborted) reject(signal.reason)
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    await Promise.race([wait(options.headerDelay ?? 0), aborted])
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        if (sent === options.stallAfter) await aborted
        await Promise.race([wait(options.chunkDelay ?? 0), aborted])
        if (sent++ >= (options.chunks ?? 1)) return stream.close()
        stream.enqueue(new TextEncoder().encode('x'))
      },
    })
    return new Response(body, { status: 200 })
  }) as typeof globalThis.fetch
  return { fetch }
}

it('aborts a request that never starts responding', async () => {
  const bounded = createBoundedFetch({ idleMs: 30, fetch: server({ headerDelay: 1_000 }).fetch })
  await expect(bounded('/api')).rejects.toMatchObject({ name: 'TimeoutError' })
})

it('lets a slow download finish while it keeps making progress', async () => {
  const bounded = createBoundedFetch({ idleMs: 40, fetch: server({ chunkDelay: 15, chunks: 8 }).fetch })
  const started = Date.now()
  expect(await (await bounded('/api')).text()).toBe('xxxxxxxx')
  expect(Date.now() - started).toBeGreaterThan(40)
})

it('aborts a download that stalls part way', async () => {
  const bounded = createBoundedFetch({ idleMs: 30, fetch: server({ chunks: 5, stallAfter: 2 }).fetch })
  const response = await bounded('/api')
  await expect(response.text()).rejects.toMatchObject({ name: 'TimeoutError' })
})

it('gives a large upload time to send before the response starts', async () => {
  const body = 'x'.repeat(100)
  const bounded = createBoundedFetch({ idleMs: 20, uploadBytesPerMs: 1, fetch: server({ headerDelay: 60 }).fetch })
  expect(await (await bounded('/api', { method: 'POST', body })).text()).toBe('x')
})

it('still honours the caller\'s abort without AbortSignal.any', async () => {
  const any = AbortSignal.any
  // Safari before 17.4.
  ;(AbortSignal as any).any = undefined
  try {
    const controller = new AbortController()
    const bounded = createBoundedFetch({ idleMs: 1_000, fetch: server({ headerDelay: 1_000 }).fetch })
    const request = bounded('/api', { signal: controller.signal })
    controller.abort(new Error('caller cancelled'))
    await expect(request).rejects.toThrow('caller cancelled')
    const alreadyAborted = new AbortController()
    alreadyAborted.abort(new Error('before start'))
    await expect(bounded('/api', { signal: alreadyAborted.signal })).rejects.toThrow('before start')
  } finally { (AbortSignal as any).any = any }
})
