import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  CorporateActionAmendmentType,
  NormalizedCorporateAction,
} from "./contract.ts"

export type CorporateActionEvidenceSnapshot = {
  source: string
  sourceEventId: string
  sourceUrl: string
  ticker: string | null
  rawPayload: unknown
  rawEvidenceHash: string
  sourcePublishedAt?: string | null
  sourceUpdatedAt?: string | null
  amendmentType?: CorporateActionAmendmentType | null
  referencedNoticeNumber?: string | null
  referencedNoticeDate?: string | null
  referencedSourceEventId?: string | null
}

export type CorporateActionPersistenceResult = {
  evidenceId: string
  actionCount: number
  appliedCount: number
  staleCount: number
}

type CanonicalRow = {
  ticker: string
  isin: string | null
  exchange: string
  action_type: string
  status: string
  record_date: string | null
  ex_date: string | null
  ex_date_basis: string
  ex_date_derivation_method: string | null
  trading_calendar_version: string | null
  cash_per_share: number | string | null
  stock_ratio_numerator: number | string | null
  stock_ratio_denominator: number | string | null
  rights_ratio_numerator: number | string | null
  rights_ratio_denominator: number | string | null
  subscription_price: number | string | null
  source: string
  source_event_id: string
  lineage_root_source_event_id: string
  source_component_key: string
  source_url: string
  raw_evidence_hash: string
  source_published_at: string | null
  source_updated_at: string | null
  normalization_version: string
}

function actionPayload(action: NormalizedCorporateAction) {
  return {
    ticker: action.ticker,
    isin: action.isin,
    exchange: action.exchange,
    action_type: action.actionType,
    status: action.status,
    record_date: action.recordDate,
    ex_date: action.exDate,
    ex_date_basis: action.exDateBasis,
    ex_date_derivation_method: action.exDateDerivationMethod,
    trading_calendar_version: action.tradingCalendarVersion,
    cash_per_share: action.cashPerShare,
    stock_ratio_numerator: action.stockRatioNumerator,
    stock_ratio_denominator: action.stockRatioDenominator,
    rights_ratio_numerator: action.rightsRatioNumerator,
    rights_ratio_denominator: action.rightsRatioDenominator,
    subscription_price: action.subscriptionPrice,
    source: action.source,
    source_event_id: action.sourceEventId,
    lineage_root_source_event_id: action.lineageRootSourceEventId,
    source_component_key: action.sourceComponentKey,
    source_url: action.sourceUrl,
    raw_evidence_hash: action.rawEvidenceHash,
    source_published_at: action.sourcePublishedAt,
    source_updated_at: action.sourceUpdatedAt,
    normalization_version: action.normalizationVersion,
  }
}

function evidencePayload(evidence: CorporateActionEvidenceSnapshot) {
  return {
    source: evidence.source,
    source_event_id: evidence.sourceEventId,
    source_url: evidence.sourceUrl,
    ticker: evidence.ticker,
    raw_payload: evidence.rawPayload,
    raw_evidence_hash: evidence.rawEvidenceHash,
    source_published_at: evidence.sourcePublishedAt ?? null,
    source_updated_at: evidence.sourceUpdatedAt ?? null,
    amendment_type: evidence.amendmentType ?? null,
    referenced_notice_number: evidence.referencedNoticeNumber ?? null,
    referenced_notice_date: evidence.referencedNoticeDate ?? null,
    referenced_source_event_id: evidence.referencedSourceEventId ?? null,
  }
}

function numericEqual(actual: number | string | null, expected: number | null) {
  if (actual === null || expected === null) return actual === null && expected === null
  return Number(actual) === expected
}

function timestampEqual(actual: string | null, expected: string | null) {
  if (actual === null || expected === null) return actual === expected
  const actualTime = Date.parse(actual)
  const expectedTime = Date.parse(expected)
  return Number.isFinite(actualTime) && Number.isFinite(expectedTime) && actualTime === expectedTime
}

function rowMatches(row: CanonicalRow, action: NormalizedCorporateAction) {
  return row.ticker === action.ticker
    && row.isin === action.isin
    && row.exchange === action.exchange
    && row.action_type === action.actionType
    && row.status === action.status
    && row.record_date === action.recordDate
    && row.ex_date === action.exDate
    && row.ex_date_basis === action.exDateBasis
    && row.ex_date_derivation_method === action.exDateDerivationMethod
    && row.trading_calendar_version === action.tradingCalendarVersion
    && numericEqual(row.cash_per_share, action.cashPerShare)
    && numericEqual(row.stock_ratio_numerator, action.stockRatioNumerator)
    && numericEqual(row.stock_ratio_denominator, action.stockRatioDenominator)
    && numericEqual(row.rights_ratio_numerator, action.rightsRatioNumerator)
    && numericEqual(row.rights_ratio_denominator, action.rightsRatioDenominator)
    && numericEqual(row.subscription_price, action.subscriptionPrice)
    && row.source === action.source
    && row.source_event_id === action.sourceEventId
    && row.lineage_root_source_event_id === action.lineageRootSourceEventId
    && row.source_component_key === action.sourceComponentKey
    && row.source_url === action.sourceUrl
    && row.raw_evidence_hash === action.rawEvidenceHash
    && timestampEqual(row.source_published_at, action.sourcePublishedAt)
    && timestampEqual(row.source_updated_at, action.sourceUpdatedAt)
    && row.normalization_version === action.normalizationVersion
}

function persistenceResult(data: unknown): CorporateActionPersistenceResult {
  if (!data || typeof data !== "object") throw new Error("Corporate action persistence returned an invalid result")
  const row = data as Record<string, unknown>
  const evidenceId = typeof row.evidence_id === "string" ? row.evidence_id : ""
  const actionCount = Number(row.action_count)
  const appliedCount = Number(row.applied_count)
  const staleCount = Number(row.stale_count)
  if (!evidenceId || ![actionCount, appliedCount, staleCount].every(Number.isSafeInteger)) {
    throw new Error("Corporate action persistence returned an invalid result")
  }
  return { evidenceId, actionCount, appliedCount, staleCount }
}

export async function persistCorporateActionNotice(
  supabase: SupabaseClient,
  evidence: CorporateActionEvidenceSnapshot,
  actions: NormalizedCorporateAction[],
): Promise<CorporateActionPersistenceResult> {
  if (actions.length === 0) throw new Error("Corporate action persistence requires at least one normalized component")

  const { data, error } = await supabase.rpc("persist_corporate_action_notice", {
    p_evidence: evidencePayload(evidence),
    p_actions: actions.map(actionPayload),
  })
  if (error) throw new Error("Corporate action persistence failed")

  const result = persistenceResult(data)
  if (result.actionCount !== actions.length || result.appliedCount + result.staleCount !== actions.length) {
    throw new Error("Corporate action persistence count mismatch")
  }

  // A stale source snapshot is retained as evidence by the RPC but intentionally does
  // not replace newer canonical state. Exact read-back applies to components accepted
  // as canonical by this call; a fully stale call therefore exits after count checks.
  if (result.staleCount === actions.length) return result

  for (const action of actions) {
    const { data: row, error: readError } = await supabase
      .from("corporate_actions")
      .select("ticker,isin,exchange,action_type,status,record_date,ex_date,ex_date_basis,ex_date_derivation_method,trading_calendar_version,cash_per_share,stock_ratio_numerator,stock_ratio_denominator,rights_ratio_numerator,rights_ratio_denominator,subscription_price,source,source_event_id,lineage_root_source_event_id,source_component_key,source_url,raw_evidence_hash,source_published_at,source_updated_at,normalization_version")
      .eq("source", action.source)
      .eq("lineage_root_source_event_id", action.lineageRootSourceEventId)
      .eq("source_component_key", action.sourceComponentKey)
      .maybeSingle()

    if (readError || !row || !rowMatches(row as CanonicalRow, action)) {
      throw new Error("Corporate action canonical read-back mismatch")
    }
  }

  return result
}
