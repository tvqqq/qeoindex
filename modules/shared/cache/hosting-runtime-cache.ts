import { isFirebaseAppHosting } from "../hosting.ts"

/**
 * Vercel Runtime Cache is platform-specific. Firebase App Hosting falls back to
 * the existing Upstash Redis L2 used by our market/UI readers. Do not retain
 * process-local results on Firebase: instances don't share invalidation state.
 *
 * Without UPSTASH_REDIS_REST_URL/TOKEN, this tier is a deliberate no-op,
 * preserving correctness at the cost of higher provider/DB read traffic.
 */
export function getHostingCache(
  { namespace }: { namespace: string },
  env: Record<string, string | undefined> = process.env,
) {
  if (isFirebaseAppHosting(env)) {
    return {
      get: async (_key: string): Promise<unknown> => null,
      set: async (_key: string, _value: unknown, _options: { ttl: number; tags: string[]; name: string }): Promise<void> => {},
      expireTag: async (_tag: string): Promise<void> => {},
    }
  }
  return {
    async get(key: string) {
      const { getCache } = await import("@vercel/functions")
      return getCache({ namespace }).get(key)
    },
    async set(key: string, value: unknown, options: { ttl: number; tags: string[]; name: string }) {
      const { getCache } = await import("@vercel/functions")
      return getCache({ namespace }).set(key, value, options)
    },
    async expireTag(tag: string) {
      const { getCache } = await import("@vercel/functions")
      return getCache({ namespace }).expireTag(tag)
    },
  }
}
