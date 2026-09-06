export type CorporateActionExchange = "HOSE" | "HNX" | "UPCOM"

export type CorporateActionType =
  | "cash_dividend"
  | "stock_dividend"
  | "bonus_issue"
  | "stock_split"
  | "rights_issue"

export type CorporateActionAmendmentType = "correction" | "replacement" | "cancellation"

export type SourceCorporateActionComponent = {
  actionType: CorporateActionType
  cashPerShare: number | null
  stockRatio: string | null
  rightsRatio: string | null
  subscriptionPrice: number | null
}

export type SourceCorporateActionNotice = {
  source: string
  sourceEventId: string
  sourceUrl: string
  sourcePublishedAt?: string | null
  sourceUpdatedAt?: string | null
  ticker: string
  isin: string | null
  exchange: CorporateActionExchange
  recordDate: string | null
  rawEvidenceHash: string
  components: SourceCorporateActionComponent[]
}

export type CorporateActionExDateInput = {
  date: string | null
  basis: "source" | "derived" | "unknown"
  derivationMethod?: string | null
  tradingCalendarVersion?: string | null
}

export type NormalizedExDateProvenance = {
  exDate: string | null
  exDateBasis: "source" | "derived" | "unknown"
  exDateDerivationMethod: string | null
  tradingCalendarVersion: string | null
}

export type CorporateActionNormalizationOptions = {
  normalizationVersion: string
  lineageRootSourceEventId?: string | null
  exDate?: CorporateActionExDateInput | null
}

export type NormalizedCorporateAction = NormalizedExDateProvenance & {
  ticker: string
  isin: string | null
  exchange: CorporateActionExchange
  actionType: CorporateActionType
  status: "active"
  recordDate: string
  cashPerShare: number | null
  stockRatioNumerator: number | null
  stockRatioDenominator: number | null
  rightsRatioNumerator: number | null
  rightsRatioDenominator: number | null
  subscriptionPrice: number | null
  source: string
  sourceEventId: string
  lineageRootSourceEventId: string
  sourceComponentKey: string
  sourceUrl: string
  rawEvidenceHash: string
  sourcePublishedAt: string | null
  sourceUpdatedAt: string | null
  normalizationVersion: string
}

export type RejectedCorporateActionComponent = {
  sourceComponentKey: string
  reason:
    | "missing_record_date"
    | "missing_lineage_root"
    | "missing_cash_per_share"
    | "missing_stock_ratio"
    | "missing_rights_ratio"
    | "missing_subscription_price"
    | "unsupported_terms"
}

export type CorporateActionNormalizationResult = {
  actions: NormalizedCorporateAction[]
  rejected: RejectedCorporateActionComponent[]
}

export type CorporateActionAmendmentIdentity = {
  sourceEventId: string
  amendmentType: CorporateActionAmendmentType | null
  referencedSourceEventId: string | null
}
