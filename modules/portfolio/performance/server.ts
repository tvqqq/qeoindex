import "server-only"

import type { ServerAuthContext } from "@/modules/auth/server"
import { fetchDnseIndexCandleHistory } from "@/modules/market/providers/dnse/index-candles"
import {
  getCachedIntraday5mSnapshot,
  getIntraday5mSnapshot,
  vietnamDateKey,
} from "@/modules/market/realtime/intraday-5m-service"
import { computePortfolioPositions, type RawTransaction, type TransactionAction } from "../pnl.ts"
import { buildEquityCurve } from "../risk-engine/equity-curve.ts"
import type { ExternalCashFlow, FundingHistoryStatus } from "../risk-engine/types.ts"
import { RiskPlanDomainError } from "../risk-plan/validation.ts"
import { buildBenchmarkComparison } from "./benchmark.ts"
import { deriveClosedTradeOutcomes } from "./closed-trades.ts"
import { deriveDrawdownAnalytics } from "./drawdown.ts"
import { buildAccountLedgers, buildTradingLedgers } from "./ledgers.ts"
import { buildTradingScorecard } from "./scorecard.ts"
import { buildPerformanceSegments } from "./segments.ts"
import type {
  BenchmarkComparison,
  BenchmarkIndexPoint,
  PerformanceJournalInput,
  PerformanceReadModel,
  PerformanceStopExitLinkInput,
  PerformanceStopInput,
  PerformanceTradeInput,
} from "./types.ts"

function dbFailure(operation: string, error: unknown): never {
  const detail = String((error as { message?: unknown } | null)?.message ?? "unknown database error")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300)
  console.error(`[QeoIndex Performance] ${operation} failed: ${detail}`)
  throw new Error(`Portfolio performance read failed during ${operation}`)
}

function finiteOrNull(value: unknown): number | null {
  if (value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizePercent(value: number): number {
  return Number(value.toFixed(10))
}

async function loadCurrentPriceMap(
  tickers: string[],
  now: Date,
): Promise<Record<string, number>> {
  const prices: Record<string, number> = {}
  if (tickers.length === 0) return prices

  const applySnapshot = (snapshot: Awaited<ReturnType<typeof getCachedIntraday5mSnapshot>>) => {
    for (const row of snapshot?.rows ?? []) {
      if (tickers.includes(row.symbol) && row.price != null && Number.isFinite(row.price) && row.price > 0) {
        prices[row.symbol] = row.price
      }
    }
  }

  const cached = await getCachedIntraday5mSnapshot(tickers, now).catch(() => null)
  applySnapshot(cached)
  const missing = tickers.filter((ticker) => prices[ticker] == null)
  if (missing.length > 0) {
    const provider = await getIntraday5mSnapshot(missing, now).catch(() => null)
    applySnapshot(provider)
  }
  return prices
}

async function loadBenchmark(
  equityPoints: PerformanceReadModel["equity"]["points"],
  now: Date,
): Promise<BenchmarkComparison> {
  const history = await fetchDnseIndexCandleHistory("VNINDEX", now, "1D").catch(() => null)
  const vnindexPoints: BenchmarkIndexPoint[] = (history?.bars ?? [])
    .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
    .map((bar) => ({
      date: vietnamDateKey(new Date(bar.time * 1000)),
      close: bar.close,
    }))
  return buildBenchmarkComparison({ equityPoints, vnindexPoints })
}

export async function getPortfolioPerformanceContext(
  context: ServerAuthContext,
  portfolioId: string,
  now: Date = new Date(),
): Promise<PerformanceReadModel> {
  const [
    portfolioResult,
    transactionsResult,
    cashFlowsResult,
    tradesResult,
    journalResult,
    stopsResult,
    stopExitLinksResult,
  ] = await Promise.all([
    context.supabase
      .from("portfolios")
      .select("id,user_id,initial_capital,funding_history_status")
      .eq("id", portfolioId)
      .eq("user_id", context.user.id)
      .maybeSingle(),
    context.supabase
      .from("portfolio_transactions")
      .select("id,trade_id,ticker,action,quantity,price,fee,fee_rate,transaction_date,tags,setup_tags,mistake_tags")
      .eq("portfolio_id", portfolioId)
      .eq("user_id", context.user.id)
      .order("transaction_date", { ascending: true })
      .order("id", { ascending: true }),
    context.supabase
      .from("portfolio_external_cash_flows")
      .select("id,flow_type,signed_amount_vnd,effective_at,provenance")
      .eq("portfolio_id", portfolioId)
      .eq("user_id", context.user.id)
      .lte("effective_at", now.toISOString())
      .order("effective_at", { ascending: true })
      .order("id", { ascending: true }),
    context.supabase
      .from("portfolio_trades")
      .select("id,ticker,mode,status,timeframe,system_tags,setup_tags,initial_risk_amount,closed_at")
      .eq("portfolio_id", portfolioId)
      .eq("user_id", context.user.id),
    context.supabase
      .from("portfolio_trade_journal_entries")
      .select("trade_id,behavior_tags")
      .eq("portfolio_id", portfolioId)
      .eq("user_id", context.user.id),
    context.supabase
      .from("portfolio_trade_stop_events")
      .select("id,trade_id")
      .eq("portfolio_id", portfolioId)
      .eq("user_id", context.user.id),
    context.supabase
      .from("portfolio_trade_stop_exit_fills")
      .select("stop_event_id,transaction_id,trade_id")
      .eq("portfolio_id", portfolioId)
      .eq("user_id", context.user.id),
  ])

  if (portfolioResult.error) dbFailure("load-portfolio", portfolioResult.error)
  if (!portfolioResult.data) throw new RiskPlanDomainError("NOT_FOUND", "Portfolio was not found.")
  if (transactionsResult.error) dbFailure("load-transactions", transactionsResult.error)
  if (cashFlowsResult.error) dbFailure("load-external-cash-flows", cashFlowsResult.error)
  if (tradesResult.error) dbFailure("load-trades", tradesResult.error)
  if (journalResult.error) dbFailure("load-journal", journalResult.error)
  if (stopsResult.error) dbFailure("load-stop-events", stopsResult.error)
  if (stopExitLinksResult.error) dbFailure("load-stop-exit-links", stopExitLinksResult.error)

  const initialCapitalVnd = finiteOrNull(portfolioResult.data.initial_capital) ?? 0
  const fundingHistoryStatus: FundingHistoryStatus = portfolioResult.data.funding_history_status === "known"
    ? "known"
    : "legacy_unrecorded"
  const externalCashFlows = (cashFlowsResult.data ?? []).map((row) => ({
    id: row.id,
    flowType: row.flow_type as ExternalCashFlow["flowType"],
    signedAmountVnd: Number(row.signed_amount_vnd),
    effectiveAt: row.effective_at,
    effectiveDate: vietnamDateKey(new Date(row.effective_at)),
    provenance: row.provenance as ExternalCashFlow["provenance"],
  })) satisfies ExternalCashFlow[]

  const transactions = (transactionsResult.data ?? []).map((row) => ({
    ...row,
    action: row.action as TransactionAction,
    fee: Number(row.fee ?? 0),
    fee_rate: row.fee_rate == null ? undefined : Number(row.fee_rate),
    quantity: Number(row.quantity),
    price: Number(row.price),
    tags: row.tags ?? [],
    setup_tags: row.setup_tags ?? [],
    mistake_tags: row.mistake_tags ?? [],
  })) as RawTransaction[]

  const trades = (tradesResult.data ?? []).map((row) => ({
    ...row,
    mode: row.mode as "live" | "paper" | "unknown",
    system_tags: row.system_tags ?? [],
    setup_tags: row.setup_tags ?? [],
    initial_risk_amount: finiteOrNull(row.initial_risk_amount),
  })) as PerformanceTradeInput[]
  const journalEntries = (journalResult.data ?? []).map((row) => ({
    trade_id: row.trade_id,
    behavior_tags: row.behavior_tags ?? [],
  })) as PerformanceJournalInput[]
  const stopEvents = (stopsResult.data ?? []) as PerformanceStopInput[]
  const stopExitFillLinks = (stopExitLinksResult.data ?? []) as PerformanceStopExitLinkInput[]

  const accounting = computePortfolioPositions(transactions)
  const openTickers = accounting.positions.map((position) => position.ticker).sort()
  const currentPricesKvnd = await loadCurrentPriceMap(openTickers, now)

  const allTickers = [...new Set(transactions.map((transaction) => transaction.ticker))].sort()
  const firstTransactionDate = transactions[0]?.transaction_date ?? null
  const currentDate = vietnamDateKey(now)
  let rawRows: Array<{
    ticker: string
    session_date: string
    close: number
    source_price_unit: string
    price_basis: string
  }> = []

  if (firstTransactionDate && allTickers.length > 0) {
    const rawResult = await context.supabase
      .from("market_ohlcv_raw_daily")
      .select("ticker,session_date,close,source_price_unit,price_basis")
      .in("ticker", allTickers)
      .gte("session_date", firstTransactionDate)
      .lte("session_date", currentDate)
      .order("session_date", { ascending: true })
    if (rawResult.error) dbFailure("load-market_ohlcv_raw_daily", rawResult.error)
    rawRows = (rawResult.data ?? [])
      .filter((row) => (
        row.price_basis === "RAW"
        && row.source_price_unit === "VND_THOUSANDS"
        && Number.isFinite(Number(row.close))
        && Number(row.close) > 0
      ))
      .map((row) => ({
        ticker: row.ticker,
        session_date: row.session_date,
        close: Number(row.close),
        source_price_unit: row.source_price_unit,
        price_basis: row.price_basis,
      }))
  }

  const rawDailyCloseKvnd: Record<string, Record<string, number>> = {}
  for (const row of rawRows) {
    rawDailyCloseKvnd[row.session_date] ??= {}
    rawDailyCloseKvnd[row.session_date]![row.ticker] = row.close
  }

  const equityCurve = buildEquityCurve({
    initialCapitalVnd,
    transactions,
    sessions: Object.keys(rawDailyCloseKvnd).sort(),
    rawDailyCloseKvnd,
    current: { key: `${currentDate}:current`, pricesKvnd: currentPricesKvnd },
    externalCashFlows,
    fundingHistoryStatus,
  })

  const normalized = deriveClosedTradeOutcomes({
    trades,
    fills: transactions,
    journalEntries,
    stopEvents,
    stopExitFillLinks,
  })
  const outcomes = normalized.outcomes

  const scorecards = {
    live: buildTradingScorecard({ outcomes, population: "live", initialCapitalVnd }),
    paper: buildTradingScorecard({ outcomes, population: "paper", initialCapitalVnd }),
    combined: buildTradingScorecard({ outcomes, population: "combined", initialCapitalVnd }),
  }
  const tradingLedgers = {
    live: buildTradingLedgers(outcomes, "live"),
    paper: buildTradingLedgers(outcomes, "paper"),
    combined: buildTradingLedgers(outcomes, "combined"),
  }
  const accountLedgers = buildAccountLedgers(equityCurve.points)
  const drawdown = deriveDrawdownAnalytics(equityCurve.points)
  const lastEquity = equityCurve.points.at(-1)
  const accountTotalReturnPercent = fundingHistoryStatus === "known"
    && initialCapitalVnd > 0
    && lastEquity?.status === "complete"
    && lastEquity.flowAdjustedEquityVnd != null
    ? normalizePercent(((lastEquity.flowAdjustedEquityVnd - initialCapitalVnd) / initialCapitalVnd) * 100)
    : null

  const benchmark = await loadBenchmark(equityCurve.points, now)
  const segments = {
    live: buildPerformanceSegments(outcomes, "live"),
    paper: buildPerformanceSegments(outcomes, "paper"),
    combined: buildPerformanceSegments(outcomes, "combined"),
  }

  return {
    scorecards,
    tradingLedgers,
    accountLedgers,
    equity: {
      points: equityCurve.points,
      accountTotalReturnPercent,
      returnMethod: "flow_adjusted_simple",
      maxDrawdownPercent: drawdown.maxDrawdownPercent,
      averageDrawdownPercent: drawdown.averageDrawdownPercent,
      episodes: drawdown.episodes,
      completeness: drawdown.completeness,
    },
    benchmark,
    segments,
    evidence: {
      eligibleTradeCount: outcomes.length,
      excludedClosedTradeCount: normalized.excludedClosedTradeCount,
      legacyUngroupedTransactionCount: normalized.legacyUngroupedTransactionCount,
      tradeGroupingCompleteness: normalized.completeness,
      equityCompleteness: drawdown.completeness,
      fundingHistoryStatus,
      externalCashFlowCount: externalCashFlows.length,
    },
  }
}
