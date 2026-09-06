import type {
  CorporateActionAmendmentIdentity,
  CorporateActionExDateInput,
  CorporateActionNormalizationOptions,
  CorporateActionNormalizationResult,
  NormalizedCorporateAction,
  NormalizedExDateProvenance,
  SourceCorporateActionComponent,
  SourceCorporateActionNotice,
} from "./contract.ts"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const POSITIVE_RATIO = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/

function nonEmpty(value: string | null | undefined) {
  const normalized = value?.trim() ?? ""
  return normalized.length > 0 ? normalized : null
}

function validIsoDate(value: string | null | undefined) {
  if (!value || !ISO_DATE.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value
}

function parsePositiveRatio(value: string | null) {
  if (!value) return null
  const match = POSITIVE_RATIO.exec(value.trim())
  if (!match) return null
  const numerator = Number(match[1])
  const denominator = Number(match[2])
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) return null
  return { numerator, denominator }
}

export function normalizeExDateProvenance(input: CorporateActionExDateInput | null | undefined): NormalizedExDateProvenance {
  const date = validIsoDate(input?.date)
  if (!input || input.basis === "unknown") {
    return {
      exDate: null,
      exDateBasis: "unknown",
      exDateDerivationMethod: null,
      tradingCalendarVersion: null,
    }
  }

  if (input.basis === "source") {
    if (!date || nonEmpty(input.derivationMethod) || nonEmpty(input.tradingCalendarVersion)) {
      return {
        exDate: null,
        exDateBasis: "unknown",
        exDateDerivationMethod: null,
        tradingCalendarVersion: null,
      }
    }
    return {
      exDate: date,
      exDateBasis: "source",
      exDateDerivationMethod: null,
      tradingCalendarVersion: null,
    }
  }

  const derivationMethod = nonEmpty(input.derivationMethod)
  const tradingCalendarVersion = nonEmpty(input.tradingCalendarVersion)
  if (!date || !derivationMethod || !tradingCalendarVersion) {
    return {
      exDate: null,
      exDateBasis: "unknown",
      exDateDerivationMethod: null,
      tradingCalendarVersion: null,
    }
  }

  return {
    exDate: date,
    exDateBasis: "derived",
    exDateDerivationMethod: derivationMethod,
    tradingCalendarVersion,
  }
}

export function resolveLineageRootSourceEventId(identity: CorporateActionAmendmentIdentity) {
  const sourceEventId = nonEmpty(identity.sourceEventId)
  if (!sourceEventId) return null
  if (!identity.amendmentType) return sourceEventId
  return nonEmpty(identity.referencedSourceEventId)
}

function rejectReason(component: SourceCorporateActionComponent) {
  if (component.actionType === "cash_dividend") {
    return typeof component.cashPerShare === "number" && Number.isFinite(component.cashPerShare) && component.cashPerShare > 0
      ? null
      : "missing_cash_per_share" as const
  }

  if (component.actionType === "rights_issue") {
    if (!parsePositiveRatio(component.rightsRatio)) return "missing_rights_ratio" as const
    if (typeof component.subscriptionPrice !== "number" || !Number.isFinite(component.subscriptionPrice) || component.subscriptionPrice < 0) {
      return "missing_subscription_price" as const
    }
    return null
  }

  if (component.actionType === "stock_dividend" || component.actionType === "bonus_issue" || component.actionType === "stock_split") {
    return parsePositiveRatio(component.stockRatio) ? null : "missing_stock_ratio" as const
  }

  return "unsupported_terms" as const
}

function normalizeComponent(
  notice: SourceCorporateActionNotice,
  component: SourceCorporateActionComponent,
  index: number,
  lineageRootSourceEventId: string,
  recordDate: string,
  exDate: NormalizedExDateProvenance,
  normalizationVersion: string,
): NormalizedCorporateAction {
  const stockRatio = parsePositiveRatio(component.stockRatio)
  const rightsRatio = parsePositiveRatio(component.rightsRatio)

  return {
    ticker: notice.ticker,
    isin: notice.isin,
    exchange: notice.exchange,
    actionType: component.actionType,
    status: "active",
    recordDate,
    ...exDate,
    cashPerShare: component.actionType === "cash_dividend" ? component.cashPerShare : null,
    stockRatioNumerator: stockRatio?.numerator ?? null,
    stockRatioDenominator: stockRatio?.denominator ?? null,
    rightsRatioNumerator: rightsRatio?.numerator ?? null,
    rightsRatioDenominator: rightsRatio?.denominator ?? null,
    subscriptionPrice: component.actionType === "rights_issue" ? component.subscriptionPrice : null,
    source: notice.source,
    sourceEventId: notice.sourceEventId,
    lineageRootSourceEventId,
    sourceComponentKey: `component:${index}`,
    sourceUrl: notice.sourceUrl,
    rawEvidenceHash: notice.rawEvidenceHash,
    sourcePublishedAt: notice.sourcePublishedAt ?? null,
    sourceUpdatedAt: notice.sourceUpdatedAt ?? null,
    normalizationVersion,
  }
}

export function normalizeCorporateActionNotice(
  notice: SourceCorporateActionNotice,
  options: CorporateActionNormalizationOptions,
): CorporateActionNormalizationResult {
  const actions: NormalizedCorporateAction[] = []
  const rejected: CorporateActionNormalizationResult["rejected"] = []
  const recordDate = validIsoDate(notice.recordDate)
  const normalizationVersion = nonEmpty(options.normalizationVersion)
  const lineageRootSourceEventId = options.lineageRootSourceEventId === undefined
    ? nonEmpty(notice.sourceEventId)
    : nonEmpty(options.lineageRootSourceEventId)
  const exDate = normalizeExDateProvenance(options.exDate)

  for (const [index, component] of notice.components.entries()) {
    const sourceComponentKey = `component:${index}`
    if (!recordDate) {
      rejected.push({ sourceComponentKey, reason: "missing_record_date" })
      continue
    }
    if (!lineageRootSourceEventId || !normalizationVersion) {
      rejected.push({ sourceComponentKey, reason: "missing_lineage_root" })
      continue
    }

    const reason = rejectReason(component)
    if (reason) {
      rejected.push({ sourceComponentKey, reason })
      continue
    }

    actions.push(normalizeComponent(
      notice,
      component,
      index,
      lineageRootSourceEventId,
      recordDate,
      exDate,
      normalizationVersion,
    ))
  }

  return { actions, rejected }
}
