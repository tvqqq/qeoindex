/**
 * Bounded per-instance cache with single-flight loading.
 * Coalesces concurrent reads without caching failures.
 * Shared infrastructure caches remain the source of cross-instance reuse.
 */
export function createTtlSingleFlight<T>({
  ttlMs,
  maxEntries = 64,
  now = Date.now,
}: {
  ttlMs: number
  maxEntries?: number
  now?: () => number
}) {
  const cached = new Map<string, { value: T; expiresAt: number }>()
  const inFlight = new Map<string, Promise<T>>()

  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const hit = cached.get(key)
      if (hit && hit.expiresAt > now()) return Promise.resolve(hit.value)
      if (hit) cached.delete(key)

      const running = inFlight.get(key)
      if (running) return running

      const promise = Promise.resolve()
        .then(load)
        .then((value) => {
          if (ttlMs > 0) {
            cached.delete(key)
            cached.set(key, { value, expiresAt: now() + ttlMs })
            if (cached.size > maxEntries) {
              const oldestKey = cached.keys().next().value
              if (oldestKey !== undefined) cached.delete(oldestKey)
            }
          }
          return value
        })
        .finally(() => {
          if (inFlight.get(key) === promise) inFlight.delete(key)
        })
      inFlight.set(key, promise)
      return promise
    },
  }
}
