import "server-only"

import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import { invalidateUiCache, readThroughUiCache } from "@/modules/shared/cache/ui-data-cache"
import { MARKET_UNIVERSE_KEY, MARKET_UNIVERSE_MAX_SIZE } from "@/modules/market/universe/selection"

export interface CanonicalUniverseStock {
  ticker: string
  rank: number
  companyName: string | null
  exchange: string | null
  sector: string | null
  marketCapBillion: number
  averageVolume50d: number
  sourceAsOfDate: string
  logoPath: string
  logoKind: "official" | "generated_fallback"
  detailComplete: boolean
}

export interface CanonicalUniverseSnapshot {
  key: typeof MARKET_UNIVERSE_KEY
  runId: string
  updatedAt: string
  sourceAsOfDate: string
  selectedCount: number
  candidateCount: number
  maxSize: number
  filters: {
    minMarketCapBillion: number
    minAverageVolume50d: number
  }
  stocks: CanonicalUniverseStock[]
}

export interface CanonicalUniverseVersion {
  runId: string
  updatedAt: string
  sourceAsOfDate: string
  selectedCount: number
}

const CACHE_NAMESPACE = "market-universe:v2"
const CACHE_TAG = "market-universe"
const CACHE_TTL_SECONDS = 35 * 24 * 60 * 60

function validStock(value: unknown): value is CanonicalUniverseStock {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.ticker === "string"
    && /^[A-Z0-9]{2,12}$/.test(row.ticker)
    && Number.isInteger(Number(row.rank))
    && Number(row.rank) >= 1
    && Number(row.rank) <= MARKET_UNIVERSE_MAX_SIZE
    && Number.isFinite(Number(row.marketCapBillion))
    && Number(row.marketCapBillion) > 0
    && Number.isFinite(Number(row.averageVolume50d))
    && Number(row.averageVolume50d) > 0
    && typeof row.sourceAsOfDate === "string"
    && typeof row.logoPath === "string"
    && row.logoPath.length > 0
    && (row.logoKind === "official" || row.logoKind === "generated_fallback")
}

export function isCanonicalUniverseSnapshot(value: unknown): value is CanonicalUniverseSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const snapshot = value as Record<string, unknown>
  const stocks = snapshot.stocks
  if (snapshot.key !== MARKET_UNIVERSE_KEY || typeof snapshot.runId !== "string" || !Array.isArray(stocks)) return false
  if (!stocks.every(validStock)) return false
  if (stocks.length > MARKET_UNIVERSE_MAX_SIZE || Number(snapshot.selectedCount) !== stocks.length) return false
  if (new Set(stocks.map((stock) => (stock as CanonicalUniverseStock).ticker)).size !== stocks.length) return false
  return stocks.every((stock, index) => (stock as CanonicalUniverseStock).rank === index + 1)
}

function normalizeSnapshot(value: unknown): CanonicalUniverseSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Canonical market universe is not published")
  }
  const raw = value as Record<string, any>
  const normalized: CanonicalUniverseSnapshot = {
    key: MARKET_UNIVERSE_KEY,
    runId: String(raw.runId || ""),
    updatedAt: String(raw.updatedAt || ""),
    sourceAsOfDate: String(raw.sourceAsOfDate || ""),
    selectedCount: Number(raw.selectedCount || 0),
    candidateCount: Number(raw.candidateCount || 0),
    maxSize: Number(raw.maxSize || MARKET_UNIVERSE_MAX_SIZE),
    filters: {
      minMarketCapBillion: Number(raw.filters?.minMarketCapBillion || 0),
      minAverageVolume50d: Number(raw.filters?.minAverageVolume50d || 0),
    },
    stocks: Array.isArray(raw.stocks) ? raw.stocks.map((stock: Record<string, unknown>) => ({
      ticker: String(stock.ticker || "").toUpperCase(),
      rank: Number(stock.rank),
      companyName: stock.companyName == null ? null : String(stock.companyName),
      exchange: stock.exchange == null ? null : String(stock.exchange),
      sector: stock.sector == null ? null : String(stock.sector),
      marketCapBillion: Number(stock.marketCapBillion),
      averageVolume50d: Number(stock.averageVolume50d),
      sourceAsOfDate: String(stock.sourceAsOfDate || raw.sourceAsOfDate || ""),
      logoPath: String(stock.logoPath || ""),
      logoKind: stock.logoKind === "generated_fallback" ? "generated_fallback" : "official",
      detailComplete: Boolean(stock.detailComplete),
    })) : [],
  }
  if (!isCanonicalUniverseSnapshot(normalized)) {
    throw new Error("Canonical market universe payload is invalid or incomplete")
  }
  return normalized
}

async function loadCanonicalUniverse(): Promise<CanonicalUniverseSnapshot> {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is unavailable for canonical universe")
  const { data, error } = await supabase.rpc("qeo_current_market_universe", { p_universe_key: MARKET_UNIVERSE_KEY })
  if (error) throw new Error(`Unable to load canonical market universe: ${error.message}`)
  return normalizeSnapshot(data)
}

export async function getCanonicalUniverseVersion(): Promise<CanonicalUniverseVersion> {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is unavailable for canonical universe")

  const { data, error } = await supabase
    .from("market_universe_runs")
    .select("id, selected_count, source_as_of_date, published_at, created_at")
    .eq("universe_key", MARKET_UNIVERSE_KEY)
    .eq("status", "published")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Unable to load canonical market universe version: ${error.message}`)
  if (!data) throw new Error("Canonical market universe is not published")

  const row = data as Record<string, unknown>
  const version: CanonicalUniverseVersion = {
    runId: String(row.id || ""),
    updatedAt: String(row.published_at || ""),
    sourceAsOfDate: String(row.source_as_of_date || ""),
    selectedCount: Number(row.selected_count || 0),
  }
  if (!version.runId || !version.updatedAt || !version.sourceAsOfDate || version.selectedCount <= 0) {
    throw new Error("Canonical market universe version is invalid")
  }
  return version
}

export async function getCanonicalUniverse(): Promise<CanonicalUniverseSnapshot> {
  const version = await getCanonicalUniverseVersion()
  return readThroughUiCache({
    namespace: CACHE_NAMESPACE,
    key: `run:${version.runId}`,
    tag: CACHE_TAG,
    name: "Canonical Top Stocks universe",
    ttlSeconds: CACHE_TTL_SECONDS,
    validate: (value): value is CanonicalUniverseSnapshot => isCanonicalUniverseSnapshot(value) && value.runId === version.runId,
    shouldCache: (snapshot) => snapshot.stocks.length > 0 && snapshot.runId === version.runId,
    load: loadCanonicalUniverse,
  })
}

export async function invalidateCanonicalUniverseCache() {
  const version = await getCanonicalUniverseVersion()
  return invalidateUiCache({ namespace: CACHE_NAMESPACE, key: `run:${version.runId}`, tag: CACHE_TAG })
}

export async function getCanonicalUniverseTickers() {
  const snapshot = await getCanonicalUniverse()
  return snapshot.stocks.map((stock) => stock.ticker)
}
