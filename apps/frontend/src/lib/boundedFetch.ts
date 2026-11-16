// A connected Wi-Fi network can still have no internet. Abort a request that
// stops making progress so the replay loop can retry instead of hanging, but
// never cut off a large upload or download that is still moving on a slow link.
export function createBoundedFetch(options: {
  /** Longest wait for the response to start, or between two chunks of its body. */
  idleMs?: number
  /** Extra time to send the request body at this slowest expected upload rate. */
  uploadBytesPerMs?: number
  fetch?: typeof fetch
} = {}) {
  const idleMs = options.idleMs ?? 15_000
  const uploadBytesPerMs = options.uploadBytesPerMs ?? 32
  const send = options.fetch ?? ((input, init) => fetch(input, init))

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // AbortSignal.any is missing from Safari before 17.4, so link the signals by hand.
    const controller = new AbortController()
    const outer = init?.signal
    if (outer?.aborted) controller.abort(outer.reason)
    else outer?.addEventListener('abort', () => controller.abort(outer.reason), { once: true })

    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = (ms: number) => {
      clearTimeout(timer)
      timer = setTimeout(() => controller.abort(new DOMException('The request stopped making progress.', 'TimeoutError')), ms)
    }
    const bodySize = typeof init?.body === 'string' ? init.body.length : 0
    arm(idleMs + bodySize / uploadBytesPerMs)

    let response: Response
    try {
      response = await send(input, { ...init, signal: controller.signal })
    } catch (error) {
      clearTimeout(timer)
      throw error
    }
    if (!response.body) { clearTimeout(timer); return response }

    arm(idleMs)
    const reader = response.body.getReader()
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const { done, value } = await reader.read()
          if (done) { clearTimeout(timer); stream.close(); return }
          arm(idleMs)
          stream.enqueue(value)
        } catch (error) {
          clearTimeout(timer)
          throw error
        }
      },
      cancel(reason) {
        clearTimeout(timer)
        return reader.cancel(reason)
      },
    })
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}
