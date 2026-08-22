import "server-only"

import { FA_SCREEN_ROWS, FA_SCREEN_SNAPSHOT_DATE, FA_VALUATION_ORDER, type FaValuation } from "@/lib/fa-screen-data"
import { getResearchOverviewData } from "@/lib/research-data"
import { getScannerData, type DailyScanRow } from "@/lib/scanner-data"
import { getSignalUiData, type SignalEventRow, type TradeRecommendation } from "@/lib/signal-data"
import { getMarketSessionStatus } from "@/lib/session-countdown"
import { getSupabasePublicServerClient } from "@/lib/supabase/public-server"
import { fetchTradingViewIndexes, type MarketIndexQuote } from "@/lib/tradingview-index"
import { readThroughUiCache } from "@/lib/ui-data-cache"
import type { Thesis } from "@/lib/research-types"

export interface InsightsRatingRow {
  ticker: string
  sector: string
  exchange: string
  price: number | null
  priceChangePct: number | null
  compositeScore: number | null
  score4m: number | null
  canslimScore: number | null
  stockRsScore: number | null
  sectorRsScore: number | null
  stockRrgState: string
  sectorRrgState: string
  source: string
  asOfDate: string
  fetchedAt: string
}

export interface InsightsHomepageData {
  generatedAt: string
  indexes: Record<string, MarketIndexQuote>
  ratings: {
    rows: InsightsRatingRow[]
    asOfDate: string
    status: "ready" | "empty" | "unconfigured" | "error"
    message: string
  }
  research: {
    rows: Thesis[]
    pendingReviews: number
    notionLive: boolean
  }
  scanner: {
    rows: DailyScanRow[]
    generatedAt: string
    available: boolean
  }
  signals: {
    openRecommendations: TradeRecommendation[]
    recentEvents: SignalEventRow[]
    generatedAt: string
    available: boolean
  }
  valuation: {
    snapshotDate: string
    total: number
    counts: Record<FaValuation, number>
  }
}

type RatingRecord = {
  as_of_date: string
  ticker: string
  sector: string | null
  exchange: string | null
  price: number | string | null
  price_change_pct: number | string | null
  composite_score: number | string | null
  score_4m: number | string | null
  canslim_score: number | string | null
  stock_rs_score: number | string | null
  sector_rs_score: number | string | null
  stock_rrg_state: string | null
  sector_rrg_state: string | null
  source: string
  fetched_at: string
}

type RatingsReadModel = InsightsHomepageData["ratings"]

const RATING_COLUMNS = [
  "as_of_date",
  "ticker",
  "sector",
  "exchange",
  "price",
  "price_change_pct",
  "composite_score",
  "score_4m",
  "canslim_score",
  "stock_rs_score",
  "sector_rs_score",
  "stock_rrg_state",
  "sector_rrg_state",
  "source",
  "fetched_at",
].join(",")

function numberOrNull(value: number | string | null | undefined) {
  if (value == null || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function vietnamDateKey(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

function isIndexQuotes(value: unknown): value is Record<string, MarketIndexQuote> {
  return Boolean(value && typeof value === "object" && "VNINDEX" in value)
}

async function getInsightsIndexes(now = new Date()) {
  const session = getMarketSessionStatus(now)
  const ttlSeconds = session.isLiveSession ? 15 : Math.min(session.ttlSeconds, 3600)
  return readThroughUiCache({
    namespace: "market-indexes-v1",
    key: `indexes:${vietnamDateKey(now)}:${session.cacheBucketKey}`,
    tag: "market-indexes",
    name: "QeoIndex public Insights indexes",
    ttlSeconds,
    validate: isIndexQuotes,
    load: fetchTradingViewIndexes,
  })
}

function isRatingsReadModel(value: unknown): value is RatingsReadModel {
  if (!value || typeof value !== "object") return false
  const model = value as Partial<RatingsReadModel>
  return Array.isArray(model.rows) && typeof model.asOfDate === "string" && typeof model.status === "string"
}

async function loadLatestRatings(): Promise<RatingsReadModel> {
  const client = getSupabasePublicServerClient()
  if (!client) {
    return {
      rows: [],
      asOfDate: "",
      status: "unconfigured",
      message: "Supabase public read client chưa được cấu hình.",
    }
  }

  const latest = await client
    .from("insights_stock_ratings")
    .select("as_of_date")
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest.error) throw latest.error
  const asOfDate = String(latest.data?.as_of_date ?? "")
  if (!asOfDate) {
    return {
      rows: [],
      asOfDate: "",
      status: "empty",
      message: "Schema rating đã sẵn sàng; đang chờ snapshot daily đầu tiên từ nguồn dữ liệu thứ ba.",
    }
  }

  const result = await client
    .from("insights_stock_ratings")
    .select(RATING_COLUMNS)
    .eq("as_of_date", asOfDate)
    .order("composite_score", { ascending: false })
    .order("ticker", { ascending: true })
    .limit(100)

  if (result.error) throw result.error
  const rows = ((result.data ?? []) as unknown as RatingRecord[]).map((row) => ({
    ticker: row.ticker,
    sector: row.sector ?? "—",
    exchange: row.exchange ?? "—",
    price: numberOrNull(row.price),
    priceChangePct: numberOrNull(row.price_change_pct),
    compositeScore: numberOrNull(row.composite_score),
    score4m: numberOrNull(row.score_4m),
    canslimScore: numberOrNull(row.canslim_score),
    stockRsScore: numberOrNull(row.stock_rs_score),
    sectorRsScore: numberOrNull(row.sector_rs_score),
    stockRrgState: row.stock_rrg_state ?? "—",
    sectorRrgState: row.sector_rrg_state ?? "—",
    source: row.source,
    asOfDate: row.as_of_date,
    fetchedAt: row.fetched_at,
  }))

  return {
    rows,
    asOfDate,
    status: rows.length ? "ready" : "empty",
    message: rows.length ? `Snapshot ${asOfDate} · ${rows.length} mã` : "Snapshot mới nhất chưa có bản ghi hợp lệ.",
  }
}

async function getLatestRatings(): Promise<RatingsReadModel> {
  try {
    return await readThroughUiCache({
      namespace: "insights-ratings-v1",
      key: "latest",
      tag: "insights-ratings",
      name: "QeoIndex public stock ratings",
      ttlSeconds: 5 * 60,
      validate: isRatingsReadModel,
      load: loadLatestRatings,
    })
  } catch (error) {
    console.error("[QeoIndex Insights] rating read failed", error)
    return {
      rows: [],
      asOfDate: "",
      status: "error",
      message: "Không đọc được snapshot rating từ Supabase.",
    }
  }
}

function scannerRows(data: Awaited<ReturnType<typeof getScannerData>>) {
  const confidenceRank = { HIGH: 3, MEDIUM: 2, LOW: 1, "": 0 } as const
  return Object.values(data.latestScans)
    .filter((row) => row.price != null)
    .sort((a, b) => {
      const bullDelta = (b.bullProbability ?? -1) - (a.bullProbability ?? -1)
      if (bullDelta !== 0) return bullDelta
      return confidenceRank[b.confidence] - confidenceRank[a.confidence]
    })
    .slice(0, 6)
}

function valuationCounts() {
  return FA_VALUATION_ORDER.reduce<Record<FaValuation, number>>((acc, valuation) => {
    acc[valuation] = FA_SCREEN_ROWS.filter((row) => row.valuation === valuation).length
    return acc
  }, {
    "Rất hấp dẫn": 0,
    "Hấp dẫn": 0,
    "Hợp lý": 0,
    "Khá cao": 0,
    "Đắt–rủi ro": 0,
  })
}

export async function getInsightsHomepageData(): Promise<InsightsHomepageData> {
  const [indexesResult, ratingsResult, researchResult, scannerResult, signalResult] = await Promise.allSettled([
    getInsightsIndexes(),
    getLatestRatings(),
    getResearchOverviewData(),
    getScannerData(),
    getSignalUiData(),
  ])

  const research = researchResult.status === "fulfilled" ? researchResult.value : null
  const scanner = scannerResult.status === "fulfilled" ? scannerResult.value : null
  const signals = signalResult.status === "fulfilled" ? signalResult.value : null

  if (indexesResult.status === "rejected") console.error("[QeoIndex Insights] index read failed", indexesResult.reason)
  if (researchResult.status === "rejected") console.error("[QeoIndex Insights] research read failed", researchResult.reason)
  if (scannerResult.status === "rejected") console.error("[QeoIndex Insights] scanner read failed", scannerResult.reason)
  if (signalResult.status === "rejected") console.error("[QeoIndex Insights] signal read failed", signalResult.reason)

  return {
    generatedAt: new Date().toISOString(),
    indexes: indexesResult.status === "fulfilled" ? indexesResult.value : {},
    ratings: ratingsResult.status === "fulfilled" ? ratingsResult.value : {
      rows: [],
      asOfDate: "",
      status: "error",
      message: "Không đọc được snapshot rating từ Supabase.",
    },
    research: {
      rows: research?.theses.slice(0, 6) ?? [],
      pendingReviews: research?.stats?.pendingReviews ?? 0,
      notionLive: Boolean(research?.connection.notionLive),
    },
    scanner: {
      rows: scanner ? scannerRows(scanner) : [],
      generatedAt: scanner?.generatedAt ?? "",
      available: Boolean(scanner),
    },
    signals: {
      openRecommendations: signals?.recommendations.filter((row) => row.status === "Open").slice(0, 5) ?? [],
      recentEvents: signals?.events.slice(0, 5) ?? [],
      generatedAt: signals?.generatedAt ?? "",
      available: Boolean(signals),
    },
    valuation: {
      snapshotDate: FA_SCREEN_SNAPSHOT_DATE,
      total: FA_SCREEN_ROWS.length,
      counts: valuationCounts(),
    },
  }
}
