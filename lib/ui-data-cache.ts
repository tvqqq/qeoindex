import { Redis } from "@upstash/redis"
import { getCache } from "@vercel/functions"

const REDIS_PREFIX = "qeoindex:ui:v1"

let redis: Redis | null | undefined

function getRedis() {
  if (redis !== undefined) return redis
  redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? Redis.fromEnv()
    : null
  return redis
}

function sharedRedisKey(namespace: string, key: string) {
  return `${REDIS_PREFIX}:${namespace}:${key}`
}

type UiCacheOptions<T> = {
  namespace: string
  key: string
  tag: string
  name: string
  ttlSeconds: number
  validate: (value: unknown) => value is T
  shouldCache?: (value: T) => boolean
  useSharedRedis?: boolean
  load: () => Promise<T>
}

type UiCacheInvalidation = Pick<UiCacheOptions<unknown>, "namespace" | "key" | "tag"> & {
  useSharedRedis?: boolean
}

/**
 * Short-lived read-through cache for UI-facing canonical data.
 * Vercel Runtime Cache is the regional L1; Upstash Redis is an optional shared L2.
 * Dynamic route projections may opt out of Redis when their key space cannot be
 * enumerated safely for immediate write invalidation.
 * The canonical loader remains authoritative and cache failures always fail open.
 */
export async function readThroughUiCache<T>({
  namespace,
  key,
  tag,
  name,
  ttlSeconds,
  validate,
  shouldCache = () => true,
  useSharedRedis = true,
  load,
}: UiCacheOptions<T>): Promise<T> {
  const cache = getCache({ namespace })

  try {
    const cached = await cache.get(key)
    if (validate(cached)) return cached
  } catch {
    // Runtime Cache is an optimization; continue to Redis/canonical source.
  }

  const redisClient = useSharedRedis ? getRedis() : null
  const redisKey = sharedRedisKey(namespace, key)
  if (redisClient) {
    try {
      const cached = await redisClient.get<unknown>(redisKey)
      if (validate(cached)) {
        try {
          await cache.set(key, cached, { ttl: ttlSeconds, tags: [tag], name })
        } catch {
          // Redis hit remains usable even if the regional L1 write fails.
        }
        return cached
      }
    } catch {
      // Redis is optional; canonical loading remains available.
    }
  }

  const fresh = await load()
  if (!shouldCache(fresh)) return fresh

  await Promise.allSettled([
    cache.set(key, fresh, { ttl: ttlSeconds, tags: [tag], name }),
    redisClient ? redisClient.set(redisKey, fresh, { ex: ttlSeconds }) : Promise.resolve(),
  ])
  return fresh
}

/** Globally expires the Runtime Cache tag and removes the shared Redis copy. */
export async function invalidateUiCache({ namespace, key, tag, useSharedRedis = true }: UiCacheInvalidation) {
  const cache = getCache({ namespace })
  const redisClient = useSharedRedis ? getRedis() : null
  const redisKey = sharedRedisKey(namespace, key)

  await Promise.allSettled([
    cache.expireTag(tag),
    redisClient ? redisClient.del(redisKey) : Promise.resolve(),
  ])
}
