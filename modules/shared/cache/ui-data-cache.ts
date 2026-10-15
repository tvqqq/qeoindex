import { Redis } from "@upstash/redis"
import { getCache } from "@vercel/functions"
import { createIoBudget } from "./io-budget.ts"

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
  ioBudgetMs?: number
  load: () => Promise<T>
}

type UiCacheInvalidation = Pick<UiCacheOptions<unknown>, "namespace" | "key" | "tag"> & {
  useSharedRedis?: boolean
}

type UiCacheRuntime = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown, options: { ttl: number; tags: string[]; name: string }) => Promise<unknown>
}

type UiCacheRedis = {
  get: <T = unknown>(key: string) => Promise<T | null>
  set: (key: string, value: unknown, options: { ex: number }) => Promise<unknown>
}

type UiCacheAdapters = {
  getCache?: (options: { namespace: string }) => UiCacheRuntime
  getRedis?: () => UiCacheRedis | null
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
  ioBudgetMs,
  load,
}: UiCacheOptions<T>, adapters: UiCacheAdapters = {}): Promise<T> {
  const cache = (adapters.getCache ?? getCache)({ namespace })
  const ioBudget = createIoBudget(ioBudgetMs)

  const runtimeCacheRead = await ioBudget.run(() => cache.get(key))
  if (runtimeCacheRead.status === "completed" && validate(runtimeCacheRead.value)) return runtimeCacheRead.value

  const redisClient = useSharedRedis ? (adapters.getRedis ?? getRedis)() : null
  const redisKey = sharedRedisKey(namespace, key)
  if (redisClient && runtimeCacheRead.status !== "timed-out") {
    const redisCacheRead = await ioBudget.run(() => redisClient.get<unknown>(redisKey))
    if (redisCacheRead.status === "completed" && validate(redisCacheRead.value)) {
      await ioBudget.run(() => cache.set(key, redisCacheRead.value, { ttl: ttlSeconds, tags: [tag], name }))
      return redisCacheRead.value
    }
  }

  const fresh = await load()
  if (!shouldCache(fresh)) return fresh

  await ioBudget.run(() => Promise.allSettled([
    Promise.resolve().then(() => cache.set(key, fresh, { ttl: ttlSeconds, tags: [tag], name })),
    redisClient ? Promise.resolve().then(() => redisClient.set(redisKey, fresh, { ex: ttlSeconds })) : Promise.resolve(),
  ]))
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
