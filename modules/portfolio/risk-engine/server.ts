import "server-only"

import type { ServerAuthContext } from "@/modules/auth/server"
import {
  getCachedIntraday5mSnapshot,
  getIntraday5mSnapshot,
  vietnamDateKey,
} from "@/modules/market/realtime/intraday-5m-service"
import { computePortfolioPositions, type RawTransaction, type TransactionAction } from "../pnl.ts"
import { getRiskPlanOverview } from "../risk-plan/server.ts"
import type { HolidayPeriodRules, HolidayRules } from "../risk-plan/types.ts"
import { RiskPlanDomainError } from "../risk-plan/validation.ts"
import { computeOpenTradeActiveRisk, type OpenTradeRiskInput, type StopRiskInput } from "./active-risk.ts"
import { buildCurrentAccountEquity, buildEquityCurve } from "./equity-curve.ts"
import { derivePortfolioRiskState } from "./risk-state.ts"
import {
  countConsecutiveExplicitStopOuts,
  deriveGuardrailTradeOutcomes,
  evaluateHolidayPeriodRule,
  evaluateRollingTradeLoss,
  type GuardrailTradeOutcome,
} from "./trade-outcomes.ts"
import type {
  EquityPoint,
  ExternalCashFlow,
  FundingHistoryStatus,
  PortfolioRiskReadModel,
  RiskRuleEvidence,
} from "./types.ts"

function dbFailure(operation: string, error: unknown): never {
  const detail = String((error as { message?: unknown } | null)?.message ?? "unknown database error")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300)
  console.error(`[QeoIndex Portfolio Risk] ${operation} failed: ${detail}`)
  throw new Error(`Portfolio risk read failed during ${operation}`)
}

function finiteOrNull(value: unknown): number | null {
  if (value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function positiveIntegerOrNull(value: unknown): number | null {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function normalizeHolidayPeriod(value: unknown): HolidayPeriodRules | undefined {
  const source = asRecord(value)
  if (typeof source.enabled !== "boolean") return undefined
  const result: HolidayPeriodRules = { enabled: source.enabled }
  for (const key of [
    "consecutiveLosingTrades",
    "consecutiveLosingDays",
    "lossAmount",
    "lossPercent",
    "profitAmount",
    "profitPercent",
    "losingTradeWindow",
  ] as const) {
    const number = finiteOrNull(source[key])
    if (number != null) result[key] = number
  }
  return result
}

function normalizeHolidayRules(value: unknown): HolidayRules {
  const source = asRecord(value)
  return {
    daily: normalizeHolidayPeriod(source.daily),
    weekly: normalizeHolidayPeriod(source.weekly),
    monthly: normalizeHolidayPeriod(source.monthly),
  }
}

function calendarStart(dateKey: string, period: "daily" | "weekly" | "monthly"): string {
  if (period === "daily") return dateKey
  if (period === "monthly") return `${dateKey.slice(0, 7)}-01`
  const date = new Date(`${dateKey}T00:00:00Z`)
  const weekday = date.getUTCDay()
  const offset = weekday === 0 ? 6 : weekday - 1
  date.setUTCDate(date.getUTCDate() - offset)
  return date.toISOString().slice(0, 10)
}

function vnDateFromIso(value: string): string {
  return vietnamDateKey(new Date(value))
}

function periodOutcomes(
  outcomes: GuardrailTradeOutcome[],
  start: string,
  end: string,
): GuardrailTradeOutcome[] {
  return outcomes.filter((outcome) => {
    const date = vnDateFromIso(outcome.closedAt)
    return date >= start && date <= end
  })
}

function groupDailyClosedTradePnl(outcomes: GuardrailTradeOutcome[]) {
  const byDate = new Map<string, number>()
  for (const outcome of outcomes) {
    const date = vnDateFromIso(outcome.closedAt)
    byDate.set(date, (byDate.get(date) ?? 0) + outcome.netPnlVnd)
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, netPnlVnd]) => ({ date, netPnlVnd }))
}

function performanceEquityVnd(point: EquityPoint): number | null {
  if (point.status !== "complete") return null
  if (point.fundingHistoryStatus === "legacy_unrecorded") return null
  const value = point.flowAdjustedEquityVnd ?? point.equityVnd
  return value != null && Number.isFinite(value) ? value : null
}

function periodStartEquity(
  points: EquityPoint[],
  start: string,
): number | null {
  let candidate: number | null = null
  for (const point of points) {
    const performanceEquity = performanceEquityVnd(point)
    if (performanceEquity == null) continue
    if (point.kind === "baseline" || point.key < start) candidate = performanceEquity
  }
  return candidate
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

function rule(
  ruleId: string,
  severity: "reduce" | "pause",
  configuredThreshold: number | string | null,
  observedValue: number | string | null,
  status: "triggered" | "clear" | "insufficient",
  reason: string,
  source: RiskRuleEvidence["source"],
): RiskRuleEvidence {
  return { ruleId, severity, configuredThreshold, observedValue, status, reason, source }
}

export async function getPortfolioRiskContext(
  context: ServerAuthContext,
  portfolioId: string,
  now: Date = new Date(),
): Promise<PortfolioRiskReadModel> {
  const overview = await getRiskPlanOverview(context, portfolioId)
  const [
    portfolioResult,
    transactionsResult,
    cashFlowsResult,
    tradesResult,
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
      .select("id,trade_id,ticker,action,quantity,price,fee,fee_rate,transaction_date,tags")
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
      .select("id,portfolio_id,user_id,ticker,mode,status,initial_stop_loss_exit,initial_risk_amount,initial_risk_percent,opened_at,closed_at,created_at,updated_at")
      .eq("portfolio_id", portfolioId)
      .eq("user_id", context.user.id),
    context.supabase
      .from("portfolio_trade_stop_events")
      .select("id,trade_id,portfolio_id,user_id,ticker,stop_type,price,effective_at,created_at")
      .eq("portfolio_id", portfolioId)
      .eq("user_id", context.user.id),
    context.supabase
      .from("portfolio_trade_stop_exit_fills")
      .select("id,stop_event_id,transaction_id,trade_id,portfolio_id,user_id,ticker,exit_action,created_at")
      .eq("portfolio_id", portfolioId)
      .eq("user_id", context.user.id),
  ])

  if (portfolioResult.error) dbFailure("load-portfolio", portfolioResult.error)
  if (!portfolioResult.data) throw new RiskPlanDomainError("NOT_FOUND", "Portfolio was not found.")
  if (transactionsResult.error) dbFailure("load-transactions", transactionsResult.error)
  if (cashFlowsResult.error) dbFailure("load-external-cash-flows", cashFlowsResult.error)
  if (tradesResult.error) dbFailure("load-trades", tradesResult.error)
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
    tags: row.tags ?? [],
  })) as RawTransaction[]
  const tradeRows = tradesResult.data ?? []
  const stopRows = stopsResult.data ?? []
  const stopExitLinks = stopExitLinksResult.data ?? []

  const summary = computePortfolioPositions(transactions)
  const openTickers = summary.positions.map((position) => position.ticker).sort()
  const currentPricesKvnd = await loadCurrentPriceMap(openTickers, now)
  const account = buildCurrentAccountEquity({
    initialCapitalVnd,
    transactions,
    currentPricesKvnd,
    externalCashFlows,
    fundingHistoryStatus,
  })

  const openTrades = tradeRows.filter(
    (trade) => trade.status === "open" || trade.status === "partially_closed",
  ) as OpenTradeRiskInput[]
  const active = computeOpenTradeActiveRisk({
    trades: openTrades,
    fills: transactions,
    stopEvents: stopRows as StopRiskInput[],
  })

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
    rawRows = (rawResult.data ?? []).filter(
      (row) => row.price_basis === "RAW"
        && row.source_price_unit === "VND_THOUSANDS"
        && Number.isFinite(Number(row.close))
        && Number(row.close) > 0,
    ).map((row) => ({
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
  const sessions = Object.keys(rawDailyCloseKvnd).sort()
  const equityCurve = buildEquityCurve({
    initialCapitalVnd,
    transactions,
    sessions,
    rawDailyCloseKvnd,
    current: { key: `${currentDate}:current`, pricesKvnd: currentPricesKvnd },
    externalCashFlows,
    fundingHistoryStatus,
  })
  const drawdown = equityCurve.currentDrawdown
  const dailyPoints = equityCurve.points.filter((point) => point.kind === "daily")
  const rawDailyCoverage: PortfolioRiskReadModel["evidence"]["rawDailyCoverage"] = transactions.length === 0
    ? "complete"
    : dailyPoints.length === 0
      ? "insufficient"
      : dailyPoints.every((point) => point.status === "complete")
        ? "complete"
        : "partial"

  const plan = overview.currentMoneyManagementPlan
  const configuredDefaultTradeRiskPercent = finiteOrNull(plan?.default_trade_risk_percent) ?? 2
  const maxActiveRiskPercent = finiteOrNull(plan?.max_active_risk_percent)
  const reductionFactor = finiteOrNull(plan?.risk_reduction_factor)
  const hasKnownCurrentEquity = fundingHistoryStatus === "known"
    && account.equityVnd != null
    && account.equityVnd > 0
  const activeRiskPercent = hasKnownCurrentEquity
    ? (active.knownActiveRiskVnd / account.equityVnd!) * 100
    : null
  const maxActiveRiskVnd = hasKnownCurrentEquity
    && maxActiveRiskPercent != null
    && maxActiveRiskPercent >= 0
    ? Math.round(account.equityVnd! * maxActiveRiskPercent / 100)
    : null
  const remainingRiskBudgetVnd = maxActiveRiskVnd == null
    ? null
    : maxActiveRiskVnd - active.knownActiveRiskVnd
  const activeCoverage = fundingHistoryStatus === "known" && active.unknownRiskItemCount === 0
    ? "complete"
    : "partial"

  const outcomes = deriveGuardrailTradeOutcomes({
    trades: tradeRows,
    fills: transactions,
    stopEvents: stopRows,
    stopExitFillLinks: stopExitLinks,
  })
  const rules: RiskRuleEvidence[] = []

  if (active.unknownRiskItemCount > 0 && maxActiveRiskVnd == null) {
    rules.push(rule(
      "active_risk_coverage",
      "reduce",
      maxActiveRiskPercent,
      active.unknownRiskItemCount,
      "insufficient",
      "One or more open Trades do not have complete current stop/risk evidence.",
      "active_risk",
    ))
  }

  if (maxActiveRiskPercent != null) {
    if (fundingHistoryStatus !== "known") {
      rules.push(rule(
        "max_active_risk",
        "reduce",
        maxActiveRiskPercent,
        null,
        "insufficient",
        "Funding history is not recorded, so the Account Equity denominator for Active Risk % is not reliable.",
        "active_risk",
      ))
    } else if (account.equityVnd == null || !(account.equityVnd > 0)) {
      rules.push(rule("max_active_risk", "reduce", maxActiveRiskPercent, null, "insufficient", "Account Equity is unavailable for the Active Risk cap.", "active_risk"))
    } else if (maxActiveRiskVnd != null && active.knownActiveRiskVnd > maxActiveRiskVnd) {
      rules.push(rule("max_active_risk", "reduce", maxActiveRiskPercent, activeRiskPercent, "triggered", "Known Active Risk exceeds the configured Max Active Risk cap.", "active_risk"))
    } else if (active.unknownRiskItemCount > 0) {
      rules.push(rule("max_active_risk", "reduce", maxActiveRiskPercent, activeRiskPercent, "insufficient", "Known Active Risk is below the cap, but current risk coverage is incomplete.", "active_risk"))
    } else {
      rules.push(rule("max_active_risk", "reduce", maxActiveRiskPercent, activeRiskPercent, "clear", "Active Risk is within the configured cap.", "active_risk"))
    }
  }

  if (plan?.drawdown_reduce_enabled) {
    const threshold = finiteOrNull(plan.drawdown_reduce_threshold_percent)
    const status = threshold == null || drawdown.drawdownPercent == null
      ? "insufficient"
      : drawdown.drawdownPercent >= threshold
        ? "triggered"
        : "clear"
    rules.push(rule(
      "drawdown_reduce",
      "reduce",
      threshold,
      drawdown.drawdownPercent,
      status,
      status === "triggered" ? "Drawdown reached the configured risk-reduction threshold." : status === "clear" ? "Drawdown is below the configured risk-reduction threshold." : "Drawdown evidence or threshold is unavailable.",
      "account_equity",
    ))
  }

  if (plan?.drawdown_pause_enabled) {
    const threshold = finiteOrNull(plan.drawdown_pause_threshold_percent)
    const status = threshold == null || drawdown.drawdownPercent == null
      ? "insufficient"
      : drawdown.drawdownPercent >= threshold
        ? "triggered"
        : "clear"
    rules.push(rule(
      "drawdown_pause",
      "pause",
      threshold,
      drawdown.drawdownPercent,
      status,
      status === "triggered" ? "Drawdown reached the configured pause threshold." : status === "clear" ? "Drawdown is below the configured pause threshold." : "Drawdown evidence or threshold is unavailable.",
      "account_equity",
    ))
  }

  if (plan?.consecutive_stop_outs_enabled) {
    const threshold = positiveIntegerOrNull(plan.consecutive_stop_outs_threshold)
    const observed = countConsecutiveExplicitStopOuts(outcomes)
    const status = threshold == null ? "insufficient" : observed >= threshold ? "triggered" : "clear"
    rules.push(rule(
      "consecutive_stop_outs",
      "pause",
      threshold,
      observed,
      status,
      status === "triggered" ? "The configured consecutive explicit stop-out threshold was reached." : status === "clear" ? "The explicit stop-out streak is below the configured threshold." : "The consecutive stop-out threshold is unavailable.",
      "canonical_closed_trades",
    ))
  }

  if (plan?.rolling_trade_loss_enabled) {
    const tradeCount = positiveIntegerOrNull(plan.rolling_trade_count)
    const evaluation = tradeCount == null
      ? { status: "insufficient" as const, sampleSize: outcomes.length, aggregateNetPnlVnd: null }
      : evaluateRollingTradeLoss(outcomes, tradeCount)
    rules.push(rule(
      "rolling_trade_loss",
      "pause",
      tradeCount,
      evaluation.aggregateNetPnlVnd,
      evaluation.status,
      evaluation.status === "triggered" ? `The latest ${tradeCount} eligible Trades have negative aggregate net P&L.` : evaluation.status === "clear" ? `The latest ${tradeCount} eligible Trades do not have negative aggregate net P&L.` : `Fewer than ${tradeCount ?? "the configured number of"} eligible closed Trades are available.`,
      "canonical_closed_trades",
    ))
  }

  const holidayRules = normalizeHolidayRules(plan?.holiday_rules)
  const dailyNetPnlVnd = groupDailyClosedTradePnl(outcomes)
  for (const period of ["daily", "weekly", "monthly"] as const) {
    const holidayRule = holidayRules[period]
    if (!holidayRule?.enabled) continue
    const start = calendarStart(currentDate, period)
    const scopedOutcomes = periodOutcomes(outcomes, start, currentDate)
    const scopedDays = dailyNetPnlVnd.filter((day) => day.date >= start && day.date <= currentDate)
    const evaluation = evaluateHolidayPeriodRule({
      period,
      rule: holidayRule,
      outcomes: scopedOutcomes,
      dailyNetPnlVnd: scopedDays,
      periodStartEquityVnd: periodStartEquity(equityCurve.points, start),
    })
    rules.push(rule(
      `holiday_${period}`,
      "pause",
      JSON.stringify(holidayRule),
      evaluation.triggeredFields.length > 0 ? evaluation.triggeredFields.join(",") : null,
      evaluation.status,
      evaluation.status === "triggered" ? `The enabled ${period} holiday rule triggered: ${evaluation.triggeredFields.join(", ")}.` : evaluation.status === "clear" ? `The enabled ${period} holiday rule is clear.` : `The enabled ${period} holiday rule lacks evidence for: ${evaluation.insufficientFields.join(", ") || "configured thresholds"}.`,
      "canonical_closed_trades",
    ))
  }

  const riskState = derivePortfolioRiskState({
    configuredDefaultTradeRiskPercent,
    reductionFactor,
    rules,
  })

  return {
    account,
    activeRisk: {
      ...active,
      activeRiskPercent,
      maxActiveRiskVnd,
      remainingRiskBudgetVnd,
      coverage: activeCoverage,
    },
    drawdown,
    riskState,
    evidence: {
      rawDailyCoverage,
      currentPriceMissingTickers: account.missingPriceTickers,
      fundingHistoryStatus,
      externalCashFlowCount: externalCashFlows.length,
    },
  }
}
