export type CanonicalFactorActionType =
  | "cash_dividend"
  | "stock_dividend"
  | "bonus_issue"
  | "stock_split"
  | "rights_issue"

export type CanonicalFactorAction = {
  id: string
  ticker: string
  actionType: CanonicalFactorActionType
  exDate: string
  cashPerShare: number | null
  stockRatioNumerator: number | null
  stockRatioDenominator: number | null
  rightsRatioNumerator: number | null
  rightsRatioDenominator: number | null
  subscriptionPrice: number | null
  normalizationVersion: string
  rawEvidenceHash: string
  source: string
  lineageRootSourceEventId: string
  sourceComponentKey: string
}

export type AdjustmentEventSet = {
  ticker: string
  exDate: string
  previousRawClose: number
  events: CanonicalFactorAction[]
}

export type StepAdjustmentFormulaInputs = {
  previousRawClose: number
  totalCashPerShare: number
  freeShareRatio: number
  rightsRatio: number
  rightsSubscriptionValue: number
  splitMultiplier: number
  postEventShareUnits: number
  corporateActionIds: string[]
}

export type StepAdjustment = {
  theoreticalExPrice: number
  stepPriceFactor: number
  stepVolumeFactor: number
  corporateActionIds: string[]
  formulaInputs: StepAdjustmentFormulaInputs
}
