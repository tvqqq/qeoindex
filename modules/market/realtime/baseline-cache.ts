import { readThroughUiCache } from "../../shared/cache/ui-data-cache.ts"

export interface MarketBaseline {
  date: string
  vnindexPriorVolume: number | null
  vnindexPriorValue: number | null
  advances: number
  declines: number
  unchanged: number
  generatedAt: string
}

export interface EodReferenceMap {
  date: string
  references: Record<string, { reference: number; ceiling?: number; floor?: number; lastClose?: number }>
  generatedAt: string
}

function isMarketBaseline(value: unknown): value is MarketBaseline {
  if (!value || typeof value !== "object") return false
  const b = value as Partial<MarketBaseline>
  return typeof b.date === "string" && typeof b.generatedAt === "string"
}

function isEodReferenceMap(value: unknown): value is EodReferenceMap {
  if (!value || typeof value !== "object") return false
  const m = value as Partial<EodReferenceMap>
  return typeof m.date === "string" && typeof m.references === "object" && m.references !== null
}

/**
 * Cache session baselines (yesterday's volume, value, market breadth) in Upstash Redis
 * TTL is 12 hours (43,200s).
 */
export async function getMarketBaselineCached(
  date: string,
  loader: () => Promise<MarketBaseline>
): Promise<MarketBaseline> {
  return readThroughUiCache<MarketBaseline>({
    namespace: "market-baseline-v1",
    key: `session:${date}`,
    tag: `qeoindex-baseline-${date}`,
    name: `QeoIndex Market Baseline ${date}`,
    ttlSeconds: 43_200,
    validate: isMarketBaseline,
    load: loader,
  })
}

/**
 * Cache 100 stock EOD reference prices in Upstash Redis.
 * TTL is 12 hours (43,200s).
 */
export async function getEodReferencePricesCached(
  date: string,
  loader: () => Promise<EodReferenceMap>
): Promise<EodReferenceMap> {
  return readThroughUiCache<EodReferenceMap>({
    namespace: "eod-references-v1",
    key: `eod:${date}`,
    tag: `qeoindex-references-${date}`,
    name: `QeoIndex EOD References ${date}`,
    ttlSeconds: 43_200,
    validate: isEodReferenceMap,
    load: loader,
  })
}
