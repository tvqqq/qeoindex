import type {
  AdjustmentEventSet,
  CanonicalFactorAction,
  StepAdjustment,
  StepAdjustmentFormulaInputs,
} from "./types.ts"

const VND_PER_KILO_VND = 1_000

export type AdjustmentFactorErrorCode =
  | "INVALID_REFERENCE_CLOSE"
  | "EVENT_TICKER_MISMATCH"
  | "EVENT_DATE_MISMATCH"
  | "DUPLICATE_ACTION_ID"
  | "INVALID_CASH_AMOUNT"
  | "INVALID_STOCK_RATIO"
  | "INVALID_RIGHTS_RATIO"
  | "MISSING_SUBSCRIPTION_PRICE"
  | "CONTRADICTORY_TERMS"
  | "UNSUPPORTED_SPLIT_COMPOSITION"
  | "NON_POSITIVE_THEORETICAL_VALUE"
  | "UNSUPPORTED_ACTION_TYPE"

export class AdjustmentFactorError extends Error {
  readonly code: AdjustmentFactorErrorCode

  constructor(code: AdjustmentFactorErrorCode, message: string) {
    super(message)
    this.name = "AdjustmentFactorError"
    this.code = code
  }
}

function isFinitePositive(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function isFiniteNonNegative(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function canonicalVndToDailyPriceUnit(value: number) {
  return value / VND_PER_KILO_VND
}

function stableSourceIdentity(action: CanonicalFactorAction) {
  return [
    action.source,
    action.lineageRootSourceEventId,
    action.sourceComponentKey,
    action.actionType,
  ].join("\u0000")
}

function compareCanonicalActions(left: CanonicalFactorAction, right: CanonicalFactorAction) {
  const stableOrder = stableSourceIdentity(left).localeCompare(stableSourceIdentity(right))
  return stableOrder !== 0 ? stableOrder : left.id.localeCompare(right.id)
}

function hasStockTerms(action: CanonicalFactorAction) {
  return action.stockRatioNumerator !== null || action.stockRatioDenominator !== null
}

function hasRightsTerms(action: CanonicalFactorAction) {
  return action.rightsRatioNumerator !== null || action.rightsRatioDenominator !== null
}

function assertCommonIdentity(input: AdjustmentEventSet, action: CanonicalFactorAction) {
  if (action.ticker !== input.ticker) {
    throw new AdjustmentFactorError("EVENT_TICKER_MISMATCH", `Action ${action.id} ticker does not match ${input.ticker}`)
  }
  if (action.exDate !== input.exDate) {
    throw new AdjustmentFactorError("EVENT_DATE_MISMATCH", `Action ${action.id} ex-date does not match ${input.exDate}`)
  }
}

function assertCashAction(action: CanonicalFactorAction) {
  if (!isFinitePositive(action.cashPerShare)) {
    throw new AdjustmentFactorError("INVALID_CASH_AMOUNT", `Cash dividend ${action.id} requires a positive cash amount`)
  }
  if (hasStockTerms(action) || hasRightsTerms(action) || action.subscriptionPrice !== null) {
    throw new AdjustmentFactorError("CONTRADICTORY_TERMS", `Cash dividend ${action.id} contains non-cash terms`)
  }
}

function assertStockAction(action: CanonicalFactorAction) {
  if (!isFinitePositive(action.stockRatioNumerator) || !isFinitePositive(action.stockRatioDenominator)) {
    throw new AdjustmentFactorError("INVALID_STOCK_RATIO", `Stock action ${action.id} requires a positive ratio`)
  }
  if (action.cashPerShare !== null || hasRightsTerms(action) || action.subscriptionPrice !== null) {
    throw new AdjustmentFactorError("CONTRADICTORY_TERMS", `Stock action ${action.id} contains contradictory terms`)
  }
}

function assertRightsAction(action: CanonicalFactorAction) {
  if (!isFinitePositive(action.rightsRatioNumerator) || !isFinitePositive(action.rightsRatioDenominator)) {
    throw new AdjustmentFactorError("INVALID_RIGHTS_RATIO", `Rights action ${action.id} requires a positive ratio`)
  }
  if (!isFiniteNonNegative(action.subscriptionPrice)) {
    throw new AdjustmentFactorError("MISSING_SUBSCRIPTION_PRICE", `Rights action ${action.id} requires a subscription price`)
  }
  if (action.cashPerShare !== null || hasStockTerms(action)) {
    throw new AdjustmentFactorError("CONTRADICTORY_TERMS", `Rights action ${action.id} contains contradictory terms`)
  }
}

function validateAction(input: AdjustmentEventSet, action: CanonicalFactorAction) {
  assertCommonIdentity(input, action)

  switch (action.actionType) {
    case "cash_dividend":
      assertCashAction(action)
      return
    case "stock_dividend":
    case "bonus_issue":
    case "stock_split":
      assertStockAction(action)
      return
    case "rights_issue":
      assertRightsAction(action)
      return
    default:
      throw new AdjustmentFactorError("UNSUPPORTED_ACTION_TYPE", `Unsupported action type ${(action as { actionType: string }).actionType}`)
  }
}

function ratio(denominator: number | null, numerator: number | null, code: "INVALID_STOCK_RATIO" | "INVALID_RIGHTS_RATIO") {
  if (!isFinitePositive(denominator) || !isFinitePositive(numerator)) {
    throw new AdjustmentFactorError(code, "Adjustment ratio must be positive and finite")
  }
  return denominator / numerator
}

export function computeStepAdjustment(input: AdjustmentEventSet): StepAdjustment {
  if (!Number.isFinite(input.previousRawClose) || input.previousRawClose <= 0) {
    throw new AdjustmentFactorError("INVALID_REFERENCE_CLOSE", "previousRawClose must be positive and finite")
  }

  const orderedEvents = [...input.events].sort(compareCanonicalActions)
  const seenIds = new Set<string>()
  for (const action of orderedEvents) {
    validateAction(input, action)
    if (seenIds.has(action.id)) {
      throw new AdjustmentFactorError("DUPLICATE_ACTION_ID", `Duplicate corporate action id ${action.id}`)
    }
    seenIds.add(action.id)
  }

  const splitActions = orderedEvents.filter((action) => action.actionType === "stock_split")
  const nonCashShareActions = orderedEvents.filter((action) => (
    action.actionType === "stock_dividend"
    || action.actionType === "bonus_issue"
    || action.actionType === "rights_issue"
  ))
  if (splitActions.length > 1 || (splitActions.length === 1 && nonCashShareActions.length > 0)) {
    throw new AdjustmentFactorError(
      "UNSUPPORTED_SPLIT_COMPOSITION",
      "Engine v1 does not compose split/consolidation with other share-entitlement actions on the same ex-date",
    )
  }

  // QEO-123 canonical corporate-action monetary terms are stored in VND, while
  // the canonical Daily OHLC contract uses thousand-VND price units. Convert
  // exactly once at the factor boundary before any TERP arithmetic.
  let totalCashPerShare = 0
  let freeShareRatio = 0
  let rightsRatio = 0
  let rightsSubscriptionValue = 0
  let splitMultiplier = 1

  for (const action of orderedEvents) {
    if (action.actionType === "cash_dividend") {
      totalCashPerShare += canonicalVndToDailyPriceUnit(action.cashPerShare as number)
      continue
    }

    if (action.actionType === "stock_dividend" || action.actionType === "bonus_issue") {
      freeShareRatio += ratio(action.stockRatioDenominator, action.stockRatioNumerator, "INVALID_STOCK_RATIO")
      continue
    }

    if (action.actionType === "stock_split") {
      splitMultiplier = ratio(action.stockRatioDenominator, action.stockRatioNumerator, "INVALID_STOCK_RATIO")
      continue
    }

    if (action.actionType === "rights_issue") {
      const entitlement = ratio(action.rightsRatioDenominator, action.rightsRatioNumerator, "INVALID_RIGHTS_RATIO")
      rightsRatio += entitlement
      rightsSubscriptionValue += entitlement * canonicalVndToDailyPriceUnit(action.subscriptionPrice as number)
    }
  }

  const numeratorValue = input.previousRawClose - totalCashPerShare + rightsSubscriptionValue
  const postEventShareUnits = splitMultiplier + freeShareRatio + rightsRatio
  if (!Number.isFinite(numeratorValue) || numeratorValue <= 0 || !Number.isFinite(postEventShareUnits) || postEventShareUnits <= 0) {
    throw new AdjustmentFactorError("NON_POSITIVE_THEORETICAL_VALUE", "Event set produces a non-positive theoretical ex value")
  }

  const theoreticalExPrice = numeratorValue / postEventShareUnits
  const stepPriceFactor = theoreticalExPrice / input.previousRawClose
  const stepVolumeFactor = splitMultiplier * (1 + freeShareRatio)
  if (!Number.isFinite(theoreticalExPrice) || theoreticalExPrice <= 0 || !Number.isFinite(stepPriceFactor) || stepPriceFactor <= 0 || !Number.isFinite(stepVolumeFactor) || stepVolumeFactor <= 0) {
    throw new AdjustmentFactorError("NON_POSITIVE_THEORETICAL_VALUE", "Event set produces invalid adjustment factors")
  }

  // UUIDs are persistence/audit references. Keep them deterministically sorted,
  // but do not use their order as the arithmetic or lineage identity source.
  const corporateActionIds = [...seenIds].sort()
  const formulaInputs: StepAdjustmentFormulaInputs = {
    previousRawClose: input.previousRawClose,
    totalCashPerShare,
    freeShareRatio,
    rightsRatio,
    rightsSubscriptionValue,
    splitMultiplier,
    postEventShareUnits,
    corporateActionIds,
  }

  return {
    theoreticalExPrice,
    stepPriceFactor,
    stepVolumeFactor,
    corporateActionIds,
    formulaInputs,
  }
}
