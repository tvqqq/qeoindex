import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { StockDetailData, StockWatchlistItem } from "@/components/stock-detail/types"
import type { AiCouncilHistoryEntry } from "@/modules/ai-council/data"
import { getAiCouncilRuntimeData, type AiCouncilRuntimeData } from "@/modules/ai-council/runtime"
import { getChartOhlcv } from "@/modules/market/chart-data/timeframe-service"
import { FA_SCREEN_ROWS } from "@/modules/research/fa-screen-data"
import { buildMultiTimeframeStudies } from "@/modules/research/multi-timeframe"
import {
  getCachedDailyHistory,
  getCachedHourlyHistory,
  getCachedResearchData,
  getCachedScannerData,
} from "@/modules/shared/cache/request-cache"
import { readThroughUiCache } from "@/modules/shared/cache/ui-data-cache"
import { getInsightsRatingForTicker, type InsightsRatingRow } from "@/modules/research/insights/data"

export const VN_TOP_COMPANY_NAMES: Record<string, string> = {
  VIC: "Tập đoàn Vingroup",
  VHM: "Công ty Cổ phần Vinhomes",
  VRE: "Công ty Cổ phần Vincom Retail",
  HPG: "Tập đoàn Hòa Phát",
  VNM: "Công ty Cổ phần Sữa Việt Nam (Vinamilk)",
  FPT: "Công ty Cổ phần FPT",
  MSN: "Tập đoàn Masan",
  MWG: "Công ty Cổ phần Đầu tư Thế Giới Di Động",
  VCB: "Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank)",
  BID: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam (BIDV)",
  CTG: "Ngân hàng TMCP Công Thương Việt Nam (VietinBank)",
  TCB: "Ngân hàng TMCP Kỹ Thương Việt Nam (Techcombank)",
  MBB: "Ngân hàng TMCP Quân Đội (MBBank)",
  VPB: "Ngân hàng TMCP Việt Nam Thịnh Vượng (VPBank)",
  ACB: "Ngân hàng TMCP Á Châu (ACB)",
  HDB: "Ngân hàng TMCP Phát triển TP.HCM (HDBank)",
  STB: "Ngân hàng TMCP Sài Gòn Thương Tín (Sacombank)",
  SHB: "Ngân hàng TMCP Sài Gòn - Hà Nội (SHB)",
  VIB: "Ngân hàng TMCP Quốc tế Việt Nam (VIB)",
  TPB: "Ngân hàng TMCP Tiên Phong (TPBank)",
  SSB: "Ngân hàng TMCP Đông Nam Á (SeABank)",
  MSB: "Ngân hàng TMCP Hàng Hải Việt Nam (MSB)",
  LPB: "Ngân hàng TMCP Lộc Phát Việt Nam (LPBank)",
  GAS: "Tổng Công ty Khí Việt Nam (PV GAS)",
  PLX: "Tập đoàn Xăng Dầu Việt Nam (Petrolimex)",
  POW: "Tổng Công ty Điện lực Dầu khí Việt Nam (PV Power)",
  BSR: "Công ty Cổ phần Lọc hóa dầu Bình Sơn",
  PVD: "Tổng Công ty Cổ phần Khoan và Dịch vụ Khoan Dầu khí",
  PVS: "Tổng Công ty Cổ phần Dịch vụ Kỹ thuật Dầu khí Việt Nam",
  SAB: "Tổng Công ty Cổ phần Bia - Rượu - Nước giải khát Sài Gòn (Sabeco)",
  VJC: "Công ty Cổ phần Hàng không Vietjet",
  HVN: "Tổng Công ty Hàng không Việt Nam (Vietnam Airlines)",
  GVR: "Tập đoàn Công nghiệp Cao su Việt Nam",
  BVH: "Tập đoàn Bảo Việt",
  SSI: "Công ty Cổ phần Chứng khoán SSI",
  VND: "Công ty Cổ phần Chứng khoán VNDIRECT",
  VCI: "Công ty Cổ phần Chứng khoán Vietcap",
  HCM: "Công ty Cổ phần Chứng khoán TP.HCM (HSC)",
  DGC: "Công ty Cổ phần Tập đoàn Hóa chất Đức Giang",
  DCM: "Công ty Cổ phần Phân bón Dầu khí Cà Mau",
  DPM: "Tổng Công ty Phân bón và Hóa chất Dầu khí (Phú Mỹ)",
  KDH: "Công ty Cổ phần Đầu tư và Kinh doanh Nhà Khang Điền",
  NLG: "Công ty Cổ phần Đầu tư Nam Long",
  DIG: "Tổng Công ty Cổ phần Đầu tư Phát triển Xây dựng (DIC Corp)",
  DXG: "Công ty Cổ phần Tập đoàn Đất Xanh",
  PDR: "Công ty Cổ phần Phát triển Bất động sản Phát Đạt",
  KBC: "Tổng Công ty Phát triển Đô thị Kinh Bắc",
  VSC: "Công ty Cổ phần Tập đoàn Container Việt Nam",
  GMD: "Công ty Cổ phần Gemadept",
  HAH: "Công ty Cổ phần Vận tải và Xếp dỡ Hải An",
  REE: "Công ty Cổ phần Cơ Điện Lạnh (REE)",
  PNJ: "Công ty Cổ phần Vàng bạc Đá quý Phú Nhuận",
  FRT: "Công ty Cổ phần Bán lẻ Kỹ thuật số FPT (FPT Retail)",
  DGW: "Công ty Cổ phần Thế Giới Số (Digiworld)",
  BCM: "Tổng Công ty Đầu tư và Phát triển Công nghiệp (Becamex IDC)",
  NVL: "Công ty Cổ phần Tập đoàn Đầu tư Địa ốc No Va (Novaland)",
  GEX: "Công ty Cổ phần Tập đoàn GELEX",
  HSG: "Công ty Cổ phần Tập đoàn Hoa Sen",
  NKG: "Công ty Cổ phần Thép Nam Kim",
  VGC: "Tổng Công ty Viglacera",
  PC1: "Công ty Cổ phần Tập đoàn PC1",
  CTR: "Tổng Công ty Cổ phần Công trình Viettel (Viettel Construction)",
  VTP: "Tổng Công ty Cổ phần Bưu chính Viettel (Viettel Post)",
}

type StockCouncilRunRow = {
  id: string
  ticker: string
  as_of_date: string
  signal: string
  council_score: number
  confidence: number
  consensus: number
  risk_status: string
  price: number | null
  policy_version: string
  evidence_hash: string
  created_at: string
}

type StockCouncilOutcomeRow = {
  run_id: string
  outcome_status: string
  sessions_observed: number
  evaluated_through_date: string | null
  return_1d_pct: number | null
  return_5d_pct: number | null
  return_20d_pct: number | null
  mfe_20d_pct: number | null
  mae_20d_pct: number | null
  direction_correct_5d: boolean | null
}

function nullableNumber(value: unknown) {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isCouncilSignal(value: string): value is AiCouncilHistoryEntry["signal"] {
  return value === "BUY" || value === "BUY_ON_CONFIRMATION" || value === "WAIT" || value === "REDUCE" || value === "SELL"
}

function isCouncilRiskStatus(value: string): value is AiCouncilHistoryEntry["riskStatus"] {
  return value === "approve" || value === "caution" || value === "veto"
}

function normalizeOutcomeStatus(value: string): NonNullable<AiCouncilHistoryEntry["outcome"]>["status"] {
  return value === "partial" || value === "matured" || value === "unavailable" ? value : "pending"
}

function isAiCouncilRuntimeData(value: unknown): value is AiCouncilRuntimeData {
  if (!value || typeof value !== "object") return false
  const runtime = value as { data?: { generatedAt?: unknown; stocks?: unknown } }
  return typeof runtime.data?.generatedAt === "string" && Array.isArray(runtime.data?.stocks)
}

async function getStockDetailCouncilRuntime(supabase: SupabaseClient) {
  return readThroughUiCache({
    namespace: "stock-detail-ai-council-v1",
    key: "current",
    tag: "qeoindex-stock-detail-ai-council-v1",
    name: "QeoIndex stock-detail AI Council runtime",
    ttlSeconds: 5 * 60,
    validate: isAiCouncilRuntimeData,
    load: () => getAiCouncilRuntimeData(supabase, { includeHistory: false, includePromptEvidence: false }),
  })
}

async function getCanonicalDailySeed(supabase: SupabaseClient, ticker: string) {
  const to = Math.floor(Date.now() / 1000)
  const from = to - 620 * 24 * 60 * 60
  const result = await getChartOhlcv(
    { supabase },
    { ticker, resolution: "1D", from, to },
  )
  return {
    bars: result.bars,
    provider: result.metadata?.provider ?? "CANONICAL_DAILY",
    detail: "Supabase market_ohlcv_history · canonical 1D seed",
  }
}

async function getTickerAiCouncilHistory(
  supabase: SupabaseClient,
  ticker: string,
): Promise<AiCouncilHistoryEntry[]> {
  const runsResult = await supabase
    .from("ai_council_runs")
    .select("id,ticker,as_of_date,signal,council_score,confidence,consensus,risk_status,price,policy_version,evidence_hash,created_at")
    .eq("ticker", ticker)
    .order("as_of_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(8)

  if (runsResult.error || !runsResult.data?.length) return []

  const runs = runsResult.data as StockCouncilRunRow[]
  const runIds = runs.map((run) => run.id)
  const outcomeResult = await supabase
    .from("ai_council_outcomes")
    .select("run_id,outcome_status,sessions_observed,evaluated_through_date,return_1d_pct,return_5d_pct,return_20d_pct,mfe_20d_pct,mae_20d_pct,direction_correct_5d")
    .in("run_id", runIds)
  const outcomes = outcomeResult.error ? [] : (outcomeResult.data || []) as StockCouncilOutcomeRow[]
  const outcomeByRun = new Map(outcomes.map((row) => [row.run_id, row]))

  return runs.flatMap((run) => {
    if (!isCouncilSignal(run.signal) || !isCouncilRiskStatus(run.risk_status)) return []
    const outcome = outcomeByRun.get(run.id)
    return [{
      id: run.id,
      ticker: run.ticker,
      asOfDate: run.as_of_date,
      signal: run.signal,
      councilScore: Number(run.council_score),
      confidence: Number(run.confidence),
      consensus: Number(run.consensus),
      riskStatus: run.risk_status,
      price: nullableNumber(run.price),
      policyVersion: run.policy_version,
      evidenceHash: run.evidence_hash,
      createdAt: run.created_at,
      outcome: outcome ? {
        status: normalizeOutcomeStatus(outcome.outcome_status),
        sessionsObserved: Number(outcome.sessions_observed || 0),
        evaluatedThroughDate: outcome.evaluated_through_date,
        return1dPct: nullableNumber(outcome.return_1d_pct),
        return5dPct: nullableNumber(outcome.return_5d_pct),
        return20dPct: nullableNumber(outcome.return_20d_pct),
        mfe20dPct: nullableNumber(outcome.mfe_20d_pct),
        mae20dPct: nullableNumber(outcome.mae_20d_pct),
        directionCorrect5d: outcome.direction_correct_5d,
      } : null,
    }]
  })
}

export function resolveCleanCompanyName(
  ticker: string,
  candidates: (string | null | undefined)[],
  sector?: string | null,
): string {
  const normTicker = ticker.trim().toUpperCase()
  for (const candidate of candidates) {
    if (!candidate) continue
    const trimmed = candidate.trim()
    if (trimmed.toUpperCase() === normTicker) continue
    if (trimmed.toUpperCase().startsWith(`${normTicker} ·`)) continue
    if (trimmed.toUpperCase().startsWith(`${normTicker} -`)) continue
    if (sector && trimmed.toLowerCase() === sector.trim().toLowerCase()) continue
    if (trimmed.length > 2) return trimmed
  }
  if (VN_TOP_COMPANY_NAMES[normTicker]) {
    return VN_TOP_COMPANY_NAMES[normTicker]
  }
  return `Công ty Cổ phần ${normTicker}`
}

export async function fetchStockDetailData(
  ticker: string,
  supabase?: SupabaseClient,
): Promise<StockDetailData> {
  let decoded = decodeURIComponent(ticker).trim().toUpperCase()
  if (decoded === "TICKER" || !decoded) {
    decoded = "HPG"
  }

  const councilRuntimePromise = supabase
    ? getStockDetailCouncilRuntime(supabase).catch(() => null)
    : Promise.resolve(null)
  const aiHistoryPromise = supabase
    ? getTickerAiCouncilHistory(supabase, decoded).catch(() => [] as AiCouncilHistoryEntry[])
    : Promise.resolve([] as AiCouncilHistoryEntry[])
  const ratingRowPromise = supabase
    ? getInsightsRatingForTicker(supabase, decoded).catch(() => null)
    : Promise.resolve(null)
  const dailyHistoryPromise = supabase
    ? getCanonicalDailySeed(supabase, decoded).catch(() => ({ bars: [], provider: "CANONICAL_DAILY", detail: "Canonical Daily storage unavailable" }))
    : getCachedDailyHistory(decoded)
  // Stock-detail navigation must not block on external intraday providers. The chart
  // owns 1H/4H loading through the canonical /api/market/ohlcv path after render.
  const hourlyHistoryPromise = supabase
    ? Promise.resolve({ bars: [], provider: "CANONICAL_CHART_API", detail: "1H/4H loaded lazily by /api/market/ohlcv" })
    : getCachedHourlyHistory(decoded)

  const [researchData, scannerData, dailyHistory, hourlyHistory, councilRuntime, aiHistory, loadedRatingRow] = await Promise.all([
    getCachedResearchData(),
    getCachedScannerData(),
    dailyHistoryPromise,
    hourlyHistoryPromise,
    councilRuntimePromise,
    aiHistoryPromise,
    ratingRowPromise,
  ])
  const aiStock = councilRuntime?.data.stocks.find((s) => s.ticker === decoded)

  const scan = scannerData.latestScans[decoded]
  const thesis = researchData.theses.find((t) => t.ticker === decoded)
  const universeItem = scannerData.universe.find((u) => u.ticker === decoded)
  const fa = FA_SCREEN_ROWS.find((f) => f.ticker === decoded)
  const logs = researchData.logs.filter((l) => l.ticker === decoded)
  const studies = buildMultiTimeframeStudies({
    dailyBars: dailyHistory.bars,
    hourlyBars: hourlyHistory.bars,
    dailyProvider: dailyHistory.provider,
    dailyDetail: dailyHistory.detail,
    hourlyProvider: hourlyHistory.provider,
    hourlyDetail: hourlyHistory.detail,
  })

  const lastBar = dailyHistory.bars.at(-1)
  const price = scan?.price || lastBar?.close || 28000
  const changePct = scan?.changePct ?? 0
  const change = (price * changePct) / 100
  const refPrice = changePct !== 0 ? Math.round(price / (1 + changePct / 100)) : price
  const highPrice = lastBar?.high || price
  const lowPrice = lastBar?.low || price
  const ceilingPrice = Math.round(refPrice * 1.07)
  const floorPrice = Math.round(refPrice * 0.93)
  const volume = scan?.volume || lastBar?.volume || 0
  const marketCapT = universeItem?.marketCapT || 150
  const pe = fa?.pe ?? null
  const pb = fa?.pb ?? null
  const roe = fa?.roe ?? null
  const eps = pe && price ? Math.round(price / pe) : null

  const scanRows = Object.values(scannerData.latestScans)
  const watchlist: StockWatchlistItem[] = (
    scanRows.length > 0 ? scanRows.slice(0, 30) : FA_SCREEN_ROWS.slice(0, 30)
  ).map((row) => {
    const sym = row.ticker
    const uItem = scannerData.universe.find((u) => u.ticker === sym)
    const faRow = FA_SCREEN_ROWS.find((f) => f.ticker === sym)
    const p = "price" in row && typeof row.price === "number" ? row.price : 28000
    const cp = "changePct" in row && typeof row.changePct === "number" ? row.changePct : 0
    return {
      ticker: sym,
      companyName: resolveCleanCompanyName(sym, [uItem?.companyName], faRow?.sector),
      price: p,
      change: (p * cp) / 100,
      changePct: cp,
    }
  })

  if (!watchlist.some((w) => w.ticker === decoded)) {
    watchlist.unshift({
      ticker: decoded,
      companyName: resolveCleanCompanyName(decoded, [universeItem?.companyName], fa?.sector),
      price,
      change,
      changePct,
    })
  }

  let ratingRow: InsightsRatingRow | null = loadedRatingRow
  const resolvedCompanyName = resolveCleanCompanyName(
    decoded,
    [ratingRow?.companyName, universeItem?.companyName, thesis?.company],
    fa?.sector || universeItem?.sector,
  )

  if (!ratingRow) {
    ratingRow = buildFallbackRatingRow({
      ticker: decoded,
      companyName: resolvedCompanyName,
      exchange: universeItem?.rank ? "HOSE" : "HNX",
      sector: fa?.sector || universeItem?.sector || "Thị trường Việt Nam",
      rank: universeItem?.rank || fa?.rank,
      price,
      changePct,
      volume,
      marketCapT,
      pe,
      pb,
      roe,
      eps,
      scan,
    })
  }

  return {
    ticker: decoded,
    companyName: resolvedCompanyName,
    exchange: universeItem?.rank ? "HOSE" : "HNX",
    sector: fa?.sector || universeItem?.sector || "Thị trường Việt Nam",
    rank: universeItem?.rank || fa?.rank,
    price,
    change,
    changePct,
    refPrice,
    highPrice,
    lowPrice,
    ceilingPrice,
    floorPrice,
    volume,
    marketCapT,
    pe,
    pb,
    roe,
    eps,
    bars: dailyHistory.bars,
    hourlyBars: hourlyHistory.bars,
    aiStock,
    aiHistory,
    scan,
    thesis,
    fa,
    universe: universeItem,
    studies,
    logs,
    watchlist,
    ratingRow,
  }
}

export function buildFallbackRatingRow(data: {
  ticker: string
  companyName: string
  exchange: string
  sector: string
  rank?: number
  price: number
  changePct: number
  volume: number
  marketCapT: number
  pe: number | null
  pb: number | null
  roe: number | null
  eps: number | null
  scan?: { score?: number; rsScore?: number; rsi14?: number | null; taBias?: string }
}): InsightsRatingRow {
  const { ticker, companyName, exchange, sector, rank, price, changePct, volume, marketCapT, pe, pb, roe, eps, scan } = data
  const asOfDate = new Date().toISOString().slice(0, 10)
  return {
    ticker,
    companyName,
    sector,
    industryGroup: sector,
    exchange,
    isTop100: !!rank,
    top100Rank: rank ?? null,
    ratingScore: scan?.score ?? 70,
    price,
    changePercent: changePct,
    volume,
    marketCapBillion: marketCapT ? marketCapT * 1000 : null,
    score4m: 65,
    canslimScore: 70,
    pricePotential: changePct > 0 ? "Tăng ngắn hạn" : "Tích lũy",
    rsShort: scan?.rsScore ?? 65,
    rsMedium: 60,
    stockRrgState: scan?.taBias === "Bullish" ? "Dẫn dắt" : "Tích lũy",
    sectorRrgState: "Tích lũy",
    rsi14: scan?.rsi14 ?? null,
    weeklyChangePercent: changePct * 1.5,
    monthlyChangePercent: changePct * 2.8,
    beta: 1.05,
    peTtm: pe,
    pbTtm: pb,
    asOfDate,
    provider: "kfsp",
    metricGroups: {
      technical: {
        rsi_14: scan?.rsi14 ?? null,
        price_vs_sma20_pct: 2.5,
        price_vs_sma50_pct: 4.8,
        price_vs_sma200_pct: 12.3,
        macd_vs_signal: "Trên",
        position_in_bollinger_band: "Trong dải",
        range_width_10d_pct: 4.2,
        position_in_10d_range: "Vùng trên",
        range_width_20d_pct: 6.8,
        position_in_20d_range: "Vùng giữa",
        range_width_50d_pct: 12.5,
        position_in_50d_range: "Vùng trên",
        range_width_52w_pct: 35.0,
        position_in_52w_range: "Vùng đỉnh",
        distance_to_52w_high_pct: -5.2,
        distance_to_52w_low_pct: 32.1,
        volume_vs_previous_session_pct: 15.4,
        traded_value_vs_previous_session_pct: 18.2,
      },
      fundamentals: {
        company_name: companyName,
        market_cap_billion: marketCapT ? marketCapT * 1000 : null,
        charter_capital_billion: marketCapT ? Math.round(marketCapT * 300) : null,
        shares_outstanding: marketCapT && price ? Math.round((marketCapT * 1000000000) / price) : null,
        eps_ttm_vnd: eps,
        pe_ttm: pe,
        pb_ttm: pb,
        roe_ttm_pct: roe,
        net_margin_ttm_pct: 12.5,
        net_revenue_growth_pct: 18.4,
        net_income_growth_pct: 22.1,
        eps_ttm_growth_pct: 15.6,
        bvps_ttm_growth_pct: 11.2,
        roa_ttm_pct: 8.5,
        free_float_pct: 45.0,
        foreign_room_remaining_pct: 24.5,
        financial_period: "Q4/2025",
        net_revenue_ttm_billion: marketCapT ? Math.round(marketCapT * 800) : null,
        net_income_ttm_billion: marketCapT ? Math.round(marketCapT * 120) : null,
        net_foreign_trading_billion: 12.5,
        net_proprietary_trading_billion: -3.2,
        beta: 1.05,
      },
    },
    scoreComponents: {
      technical: 65,
      momentum: 70,
      moneyFlow: 68,
      fundamental: 72,
    },
    scoreHistory: [
      {
        asOfDate,
        ratingScore: scan?.score ?? 70,
        score4m: 65,
        canslimScore: 70,
        pricePotential: "Tăng ngắn hạn",
        rsShort: scan?.rsScore ?? 65,
        rsMedium: 60,
        stockRrgState: "Dẫn dắt",
        sectorRrgState: "Tích lũy",
        rsi14: scan?.rsi14 ?? null,
        weeklyChangePercent: changePct * 1.5,
        monthlyChangePercent: changePct * 2.8,
        beta: 1.05,
      },
    ],
  }
}
