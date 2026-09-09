import "server-only"

import type { ServerAuthContext } from "@/modules/auth/server"
import {
  getFreshHomepageIndexSnapshot,
  type FreshHomepageIndexSnapshot,
} from "@/modules/home/fresh-market-snapshot"
import {
  computePortfolioPositions,
  type RawTransaction,
  type TransactionAction,
} from "@/modules/portfolio/pnl"

export type HomeHeroMarket = {
  sessionDate: string | null
  vnindexValue: number | null
  changePct: number | null
  advances: number | null
  declines: number | null
  leadingSector: string | null
  leadingSectorRs: number | null
  sentimentLabel: string | null
  riskLabel: string | null
  snapshotUpdatedAt: string | null
}

export type HomeHeroPortfolio = {
  hasPortfolio: boolean
  name: string
  openPositionCount: number
  deployedCapitalVnd: number | null
  initialCapitalVnd: number | null
  exposurePct: number | null
  largestTicker: string | null
  largestPositionPct: number | null
  realizedPnlVnd: number | null
}

export type HomeHeroData = {
  headline: string
  market: HomeHeroMarket
  portfolio: HomeHeroPortfolio
}

const EMPTY_MARKET: HomeHeroMarket = {
  sessionDate: null,
  vnindexValue: null,
  changePct: null,
  advances: null,
  declines: null,
  leadingSector: null,
  leadingSectorRs: null,
  sentimentLabel: null,
  riskLabel: null,
  snapshotUpdatedAt: null,
}

const EMPTY_PORTFOLIO: HomeHeroPortfolio = {
  hasPortfolio: false,
  name: "Danh mục của bạn",
  openPositionCount: 0,
  deployedCapitalVnd: null,
  initialCapitalVnd: null,
  exposurePct: null,
  largestTicker: null,
  largestPositionPct: null,
  realizedPnlVnd: null,
}

const VALID_ACTIONS = new Set<TransactionAction>([
  "buy",
  "sell",
  "dividend_cash",
  "dividend_stock",
  "rights",
])

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = finiteNumber(value)
  if (parsed == null || parsed < 0) return null
  return Math.round(parsed)
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 120) : null
}

function asTransaction(row: Record<string, unknown>): RawTransaction | null {
  const action = String(row.action ?? "") as TransactionAction
  const quantity = finiteNumber(row.quantity)
  const price = finiteNumber(row.price)
  const fee = finiteNumber(row.fee)
  const ticker = String(row.ticker ?? "").trim().toUpperCase()
  const transactionDate = String(row.transaction_date ?? "")

  if (
    !VALID_ACTIONS.has(action) ||
    !ticker ||
    quantity == null ||
    quantity < 0 ||
    price == null ||
    price < 0 ||
    fee == null ||
    fee < 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)
  ) {
    return null
  }

  return {
    id: String(row.id ?? `${ticker}-${transactionDate}`),
    trade_id: row.trade_id == null ? null : String(row.trade_id),
    ticker,
    action,
    quantity,
    price,
    fee,
    fee_rate: finiteNumber(row.fee_rate) ?? undefined,
    transaction_date: transactionDate,
    note: row.note == null ? null : String(row.note),
    tags: Array.isArray(row.tags) ? row.tags.map(String).slice(0, 10) : [],
    setup_tags: Array.isArray(row.setup_tags) ? row.setup_tags.map(String).slice(0, 10) : [],
    mistake_tags: Array.isArray(row.mistake_tags) ? row.mistake_tags.map(String).slice(0, 10) : [],
    target_price_1: finiteNumber(row.target_price_1),
    target_price_2: finiteNumber(row.target_price_2),
    target_price_3: finiteNumber(row.target_price_3),
    stop_loss_1: finiteNumber(row.stop_loss_1),
    stop_loss_2: finiteNumber(row.stop_loss_2),
    stop_loss_3: finiteNumber(row.stop_loss_3),
  }
}

async function loadMarketSummary(context: ServerAuthContext): Promise<HomeHeroMarket> {
  const { data: daily, error: dailyError } = await context.supabase
    .from("market_insight_daily")
    .select("session_date,sentiment_score,sentiment_label,risk_score,risk_label")
    .order("session_date", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (dailyError || !daily?.session_date) return EMPTY_MARKET

  const sessionDate = String(daily.session_date)
  const [indexResult, sectorResult] = await Promise.all([
    context.supabase
      .from("market_insight_indexes")
      .select("value,change_pct,advances,declines")
      .eq("session_date", sessionDate)
      .eq("index_code", "VNINDEX")
      .maybeSingle(),
    context.supabase
      .from("market_insight_sectors")
      .select("display_name,rs_score")
      .eq("session_date", sessionDate)
      .eq("time_window", "1d")
      .not("rs_score", "is", null)
      .order("rs_score", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const index = indexResult.error ? null : indexResult.data
  const sector = sectorResult.error ? null : sectorResult.data

  return {
    sessionDate,
    vnindexValue: finiteNumber(index?.value),
    changePct: finiteNumber(index?.change_pct),
    advances: nonNegativeInteger(index?.advances),
    declines: nonNegativeInteger(index?.declines),
    leadingSector: optionalText(sector?.display_name),
    leadingSectorRs: finiteNumber(sector?.rs_score),
    sentimentLabel: optionalText(daily.sentiment_label),
    riskLabel: optionalText(daily.risk_label),
    snapshotUpdatedAt: null,
  }
}

function overlayFreshMarket(
  freshIndex: FreshHomepageIndexSnapshot | null,
  persistedMarket: HomeHeroMarket,
): HomeHeroMarket {
  if (!freshIndex) return persistedMarket
  return {
    ...persistedMarket,
    vnindexValue: freshIndex.value,
    changePct: freshIndex.changePct,
    advances: freshIndex.advances ?? persistedMarket.advances,
    declines: freshIndex.declines ?? persistedMarket.declines,
    snapshotUpdatedAt: freshIndex.updatedAt,
  }
}

async function loadPortfolioSummary(context: ServerAuthContext): Promise<HomeHeroPortfolio> {
  const { data: portfolios, error: portfolioError } = await context.supabase
    .from("portfolios")
    .select("id,name,initial_capital,is_default,sort_order,created_at")
    .eq("user_id", context.user.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(5)

  if (portfolioError || !portfolios?.length) return EMPTY_PORTFOLIO

  const portfolio = portfolios.find((item) => item.is_default) ?? portfolios[0]
  if (!portfolio?.id) return EMPTY_PORTFOLIO

  const { data: rows, error: transactionError } = await context.supabase
    .from("portfolio_transactions")
    .select("id,trade_id,ticker,action,quantity,price,fee,fee_rate,transaction_date,note,tags,setup_tags,mistake_tags,target_price_1,target_price_2,target_price_3,stop_loss_1,stop_loss_2,stop_loss_3,created_at")
    .eq("user_id", context.user.id)
    .eq("portfolio_id", portfolio.id)
    .order("transaction_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(3000)

  if (transactionError) {
    return {
      ...EMPTY_PORTFOLIO,
      hasPortfolio: true,
      name: optionalText(portfolio.name) ?? "Danh mục của bạn",
      initialCapitalVnd: finiteNumber(portfolio.initial_capital),
    }
  }

  const transactions = (rows ?? [])
    .map((row) => asTransaction(row as Record<string, unknown>))
    .filter((row): row is RawTransaction => row !== null)
  const summary = computePortfolioPositions(transactions)
  const deployedCapitalVnd = summary.positions.reduce((sum, position) => sum + position.totalInvested, 0) * 1000
  const initialCapitalVnd = finiteNumber(portfolio.initial_capital)
  const exposurePct = initialCapitalVnd != null && initialCapitalVnd > 0
    ? (deployedCapitalVnd / initialCapitalVnd) * 100
    : null
  const largest = summary.positions.reduce<(typeof summary.positions)[number] | null>(
    (current, position) => !current || position.totalInvested > current.totalInvested ? position : current,
    null,
  )
  const totalInvestedK = deployedCapitalVnd / 1000

  return {
    hasPortfolio: true,
    name: optionalText(portfolio.name) ?? "Danh mục của bạn",
    openPositionCount: summary.positions.length,
    deployedCapitalVnd,
    initialCapitalVnd,
    exposurePct,
    largestTicker: largest?.ticker ?? null,
    largestPositionPct: largest && totalInvestedK > 0 ? (largest.totalInvested / totalInvestedK) * 100 : null,
    realizedPnlVnd: summary.totalRealizedPnl * 1000,
  }
}

export function deriveHomeMarketHeadline(market: HomeHeroMarket): string {
  const risk = (market.riskLabel ?? "").toLowerCase()
  const sentiment = (market.sentimentLabel ?? "").toLowerCase()
  const breadthPositive = market.advances != null && market.declines != null && market.advances > market.declines
  const constructiveSentiment = /positive|bull|tích cực|constructive|khả quan|tham lam/.test(sentiment)

  if (/high|cao|elevated|risk[- ]?off|nguy cơ/.test(risk)) {
    return "Rủi ro đang cao\nưu tiên bảo toàn vốn"
  }
  if (breadthPositive && constructiveSentiment) {
    return "Thị trường tích cực\nđộ rộng đang mở rộng"
  }
  if (constructiveSentiment) {
    return "Dòng tiền cải thiện\nưu tiên cổ phiếu dẫn dắt"
  }
  if (/moderate|trung bình|trung tính|caution|thận trọng/.test(risk) || /sợ hãi|fear/.test(sentiment)) {
    return "Thị trường thận trọng\nchờ xác nhận rõ hơn"
  }
  return "Theo dõi thị trường\nquản trị danh mục"
}

export async function getHomeHeroData(context: ServerAuthContext): Promise<HomeHeroData> {
  const [persistedMarket, portfolio, freshIndex] = await Promise.all([
    loadMarketSummary(context).catch(() => EMPTY_MARKET),
    loadPortfolioSummary(context).catch(() => EMPTY_PORTFOLIO),
    getFreshHomepageIndexSnapshot().catch(() => null),
  ])
  const market = overlayFreshMarket(freshIndex, persistedMarket)

  return {
    market,
    portfolio,
    headline: deriveHomeMarketHeadline(market),
  }
}
