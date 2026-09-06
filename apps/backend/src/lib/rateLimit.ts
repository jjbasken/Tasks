// Fixed-window counters held in process memory.
//
// The server is a single Bun process backed by one SQLite file, so a shared
// in-memory map is the whole story — there is no second replica to coordinate
// with. If that ever changes this needs to move to the database or a cache.

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/** Drop expired buckets so a stream of distinct keys cannot grow the map without bound. */
function prune(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export type RateLimit = { key: string; limit: number; windowMs: number }

/**
 * True when every limit still has room. Counts nothing — call `recordHit` to
 * actually consume budget, so callers can charge only the attempts they want to
 * (failed logins) rather than every request.
 */
export function withinLimits(limits: RateLimit[]): boolean {
  const now = Date.now()
  return limits.every(({ key, limit }) => {
    const bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) return true
    return bucket.count < limit
  })
}

/** Charge one attempt against each limit. */
export function recordHit(limits: RateLimit[]): void {
  const now = Date.now()
  if (buckets.size > 10_000) prune(now)
  for (const { key, windowMs } of limits) {
    const bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
    } else {
      bucket.count += 1
    }
  }
}

/** Forget the recorded attempts — used after a success so a legitimate user is not penalised. */
export function clearHits(limits: RateLimit[]): void {
  for (const { key } of limits) buckets.delete(key)
}

/** Test seam: wipe all state so one test's attempts cannot leak into the next. */
export function resetAllRateLimits(): void {
  buckets.clear()
}
