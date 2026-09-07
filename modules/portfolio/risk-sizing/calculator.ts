import type {
  AccountEquityContext,
  AccountEquityInput,
  TradeSizeInput,
  TradeSizeResult,
} from "./types.ts"
import { kvndToVnd } from "./units.ts"
import { isFiniteNonNegative, isFinitePositive } from "./validation.ts"

export const DEFAULT_REGULAR_LOT_SHARES = 100

export function calculateRiskAmountVnd(accountEquityVnd: number, riskPercent: number): number {
  return accountEquityVnd * (riskPercent / 100)
}

export function calculateBookTradeSize({
  riskAmountVnd,
  commissionVnd,
  riskPerShareVnd,
}: {
  riskAmountVnd: number
  commissionVnd: number
  riskPerShareVnd: number
}): number {
  return (riskAmountVnd - commissionVnd) / riskPerShareVnd
}

function emptyResult(status: TradeSizeResult["status"], riskAmountVnd: number | null = null): TradeSizeResult {
  return {
    status,
    riskAmountVnd,
    riskPerShareVnd: null,
    stopDistanceKvnd: null,
    stopDistancePercent: null,
    availableRiskBudgetVnd: null,
    rawTradeSizeShares: null,
    tradeSizeShares: 0,
    positionValueVnd: null,
    totalRiskConsumptionVnd: null,
  }
}

export function calculateTradeSize(input: TradeSizeInput): TradeSizeResult {
  if (!isFinitePositive(input.accountEquityVnd)) return emptyResult("invalid_account_equity")
  if (!isFinitePositive(input.riskPercent) || input.riskPercent > 100) return emptyResult("invalid_risk_percent")

  const riskAmountVnd = calculateRiskAmountVnd(input.accountEquityVnd, input.riskPercent)
  if (input.riskPercent > 2 && !input.advancedRiskOverrideAcknowledged) {
    return emptyResult("advanced_override_required", riskAmountVnd)
  }

  if (!isFiniteNonNegative(input.estimatedCommissionVnd) || !isFiniteNonNegative(input.slippageAllowanceVnd)) {
    return emptyResult("invalid_cost", riskAmountVnd)
  }

  if (input.plannedEntryKvnd == null || input.initialStopKvnd == null) {
    return emptyResult("incomplete", riskAmountVnd)
  }
  if (!isFinitePositive(input.plannedEntryKvnd)) return emptyResult("invalid_entry", riskAmountVnd)
  if (!Number.isFinite(input.initialStopKvnd) || input.initialStopKvnd < 0) {
    return emptyResult("invalid_stop_direction", riskAmountVnd)
  }
  if (input.initialStopKvnd === input.plannedEntryKvnd) return emptyResult("zero_stop_distance", riskAmountVnd)
  if (input.side === "long" && input.initialStopKvnd > input.plannedEntryKvnd) {
    return emptyResult("invalid_stop_direction", riskAmountVnd)
  }

  const availableRiskBudgetVnd = riskAmountVnd - input.estimatedCommissionVnd - input.slippageAllowanceVnd
  if (!(availableRiskBudgetVnd > 0)) {
    return {
      ...emptyResult("costs_consume_risk_budget", riskAmountVnd),
      availableRiskBudgetVnd,
    }
  }

  const stopDistanceKvnd = input.plannedEntryKvnd - input.initialStopKvnd
  const riskPerShareVnd = kvndToVnd(stopDistanceKvnd)
  const stopDistancePercent = (stopDistanceKvnd / input.plannedEntryKvnd) * 100
  const rawTradeSizeShares = availableRiskBudgetVnd / riskPerShareVnd
  const lotSizeShares = Number.isFinite(input.lotSizeShares) && input.lotSizeShares > 0
    ? Math.floor(input.lotSizeShares)
    : DEFAULT_REGULAR_LOT_SHARES
  const tradeSizeShares = Math.floor(rawTradeSizeShares / lotSizeShares) * lotSizeShares

  if (tradeSizeShares < lotSizeShares) {
    return {
      status: "below_regular_lot",
      riskAmountVnd,
      riskPerShareVnd,
      stopDistanceKvnd,
      stopDistancePercent,
      availableRiskBudgetVnd,
      rawTradeSizeShares,
      tradeSizeShares: 0,
      positionValueVnd: 0,
      totalRiskConsumptionVnd: input.estimatedCommissionVnd + input.slippageAllowanceVnd,
    }
  }

  const positionValueVnd = tradeSizeShares * kvndToVnd(input.plannedEntryKvnd)
  const totalRiskConsumptionVnd = tradeSizeShares * riskPerShareVnd
    + input.estimatedCommissionVnd
    + input.slippageAllowanceVnd

  return {
    status: "ready",
    riskAmountVnd,
    riskPerShareVnd,
    stopDistanceKvnd,
    stopDistancePercent,
    availableRiskBudgetVnd,
    rawTradeSizeShares,
    tradeSizeShares,
    positionValueVnd,
    totalRiskConsumptionVnd,
  }
}

export function buildAccountEquityContext(input: AccountEquityInput): AccountEquityContext {
  const missingPriceTickers: string[] = []
  let totalUnrealizedPnlKvnd = 0

  for (const position of input.positions) {
    if (!(position.openQty > 0)) continue
    const currentPriceKvnd = input.currentPricesKvnd[position.ticker]
    if (!Number.isFinite(currentPriceKvnd)) {
      missingPriceTickers.push(position.ticker)
      continue
    }
    totalUnrealizedPnlKvnd += (currentPriceKvnd - position.avgCost) * position.openQty
  }

  const valueVnd = input.initialCapitalVnd
    + kvndToVnd(input.totalRealizedPnlKvnd)
    + kvndToVnd(totalUnrealizedPnlKvnd)

  return {
    valueVnd,
    source: missingPriceTickers.length === 0 ? "portfolio_mark_to_market" : "portfolio_partial",
    missingPriceTickers: Array.from(new Set(missingPriceTickers)).sort(),
  }
}
