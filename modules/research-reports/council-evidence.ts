import type { SupabaseClient } from "@supabase/supabase-js"

export const COUNCIL_REPORT_TICKER_LIMIT = 3
export const COUNCIL_REPORT_TICKER_LOOKBACK_DAYS = 90
export const COUNCIL_REPORT_MARKET_LIMIT = 2
export const COUNCIL_REPORT_MARKET_LOOKBACK_DAYS = 30
export const COUNCIL_REPORT_MAX_PROMPT_CHARS = 10_000

const REPORT_TABLE = "market_research_reports"
const ANALYSIS_TABLE = "market_research_report_analyses"
const MENTION_TABLE = "market_research_report_ticker_mentions"
const MAX_QUERY_ROWS = 160

export type CouncilReportCategory = "macro" | "strategy" | "sector" | "other"
export type CouncilReportRole = "ticker" | "market"
export type CouncilReportStance = "positive" | "negative" | "neutral" | "mixed"

export interface CouncilReportTickerMention {
  ticker: string
  stance: CouncilReportStance
  recommendationText: string | null
  targetPrice: number | null
  targetCurrency: string | null
  rationale: string | null
  evidence: unknown[]
  sourceOpinion: true
}

export interface CouncilReportEvidenceItem {
  reportId: string
  analysisId: string
  provider: string
  sourceName: string
  title: string
  publishDate: string
  category: CouncilReportCategory
  contentHash: string
  analysisVersion: string
  promptVersion: string
  modelRouteKey: string
  processedAt: string
  roles: CouncilReportRole[]
  executiveSummary: string
  marketView: string | null
  sectorOutlook: string | null
  catalysts: unknown[]
  risks: unknown[]
  tickerMention: CouncilReportTickerMention | null
}

export interface CouncilReportEvidenceSelection {
  ticker: string
  asOf: string
  runAt: string
  reports: CouncilReportEvidenceItem[]
  truncated: boolean
  promptChars: number
}

type ReportRow = {
  id: string
  provider: string
  source_name: string
  title: string
  publish_date: string
  category: CouncilReportCategory
  created_at: string
}

type AnalysisRow = {
  id: string
  report_id: string
  content_hash: string
  analysis_version: string
  prompt_version: string
  model_route_key: string
  processed_at: string
  executive_summary: string
  market_view: string | null
  sector_outlook: string | null
  catalysts: unknown
  risks: unknown
}

type MentionRow = {
  report_id: string
  analysis_id: string
  ticker: string
  stance: CouncilReportStance
  recommendation_text: string | null
  target_price: number | string | null
  target_currency: string | null
  rationale: string | null
  evidence: unknown
  created_at: string
}

type QueryResult = { data: unknown[] | null; error: { message?: string } | null }

type UntypedResearchClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): unknown
      lte(column: string, value: string): unknown
      gte(column: string, value: string): unknown
      in(column: string, values: unknown[]): unknown
      order(column: string, options?: { ascending?: boolean }): unknown
      limit(value: number): unknown
    } & PromiseLike<QueryResult>
  }
}

function db(client: SupabaseClient): UntypedResearchClient {
  return client as unknown as UntypedResearchClient
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback
}

function nullableText(value: unknown) {
  const normalized = text(value).trim()
  return normalized ? normalized : null
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function numberOrNull(value: unknown) {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function category(value: unknown): CouncilReportCategory {
  return value === "macro" || value === "strategy" || value === "sector" || value === "other"
    ? value
    : "other"
}

function stance(value: unknown): CouncilReportStance {
  return value === "positive" || value === "negative" || value === "neutral" || value === "mixed"
    ? value
    : "neutral"
}

function sanitizeError(value: unknown) {
  return text(record(value).message, "unknown database error")
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400)
}

function ensureRows(result: QueryResult, context: string): Record<string, unknown>[] {
  if (result.error) throw new Error(`${context}: ${sanitizeError(result.error)}`)
  return Array.isArray(result.data)
    ? result.data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : []
}

function reportRow(row: Record<string, unknown>): ReportRow | null {
  const id = nullableText(row.id)
  const provider = nullableText(row.provider)
  const sourceName = nullableText(row.source_name)
  const title = nullableText(row.title)
  const publishDate = nullableText(row.publish_date)
  const createdAt = nullableText(row.created_at)
  if (!id || !provider || !sourceName || !title || !publishDate || !createdAt) return null
  return {
    id,
    provider,
    source_name: sourceName,
    title,
    publish_date: publishDate,
    category: category(row.category),
    created_at: createdAt,
  }
}

function analysisRow(row: Record<string, unknown>): AnalysisRow | null {
  const id = nullableText(row.id)
  const reportId = nullableText(row.report_id)
  const contentHash = nullableText(row.content_hash)
  const analysisVersion = nullableText(row.analysis_version)
  const promptVersion = nullableText(row.prompt_version)
  const modelRouteKey = nullableText(row.model_route_key)
  const processedAt = nullableText(row.processed_at)
  if (!id || !reportId || !contentHash || !analysisVersion || !promptVersion || !modelRouteKey || !processedAt) return null
  return {
    id,
    report_id: reportId,
    content_hash: contentHash,
    analysis_version: analysisVersion,
    prompt_version: promptVersion,
    model_route_key: modelRouteKey,
    processed_at: processedAt,
    executive_summary: text(row.executive_summary),
    market_view: nullableText(row.market_view),
    sector_outlook: nullableText(row.sector_outlook),
    catalysts: row.catalysts,
    risks: row.risks,
  }
}

function mentionRow(row: Record<string, unknown>): MentionRow | null {
  const reportId = nullableText(row.report_id)
  const analysisId = nullableText(row.analysis_id)
  const ticker = nullableText(row.ticker)?.toUpperCase()
  const createdAt = nullableText(row.created_at)
  if (!reportId || !analysisId || !ticker || !createdAt) return null
  return {
    report_id: reportId,
    analysis_id: analysisId,
    ticker,
    stance: stance(row.stance),
    recommendation_text: nullableText(row.recommendation_text),
    target_price: row.target_price == null ? null : String(row.target_price),
    target_currency: nullableText(row.target_currency),
    rationale: nullableText(row.rationale),
    evidence: row.evidence,
    created_at: createdAt,
  }
}

function dateFloor(asOf: string, days: number) {
  const value = new Date(`${asOf}T00:00:00Z`)
  if (!Number.isFinite(value.getTime())) throw new Error(`Invalid Council report asOf date: ${asOf}`)
  value.setUTCDate(value.getUTCDate() - Math.max(0, Math.floor(days)))
  return value.toISOString().slice(0, 10)
}

function compareDesc(left: string, right: string) {
  return right.localeCompare(left)
}

function newestEligibleAnalysisByReport(rows: AnalysisRow[], runAt: string) {
  const result = new Map<string, AnalysisRow>()
  for (const row of rows) {
    if (row.processed_at > runAt) continue
    const current = result.get(row.report_id)
    if (!current
      || row.processed_at > current.processed_at
      || (row.processed_at === current.processed_at && row.id.localeCompare(current.id) < 0)) {
      result.set(row.report_id, row)
    }
  }
  return result
}

function normalizeMention(row: MentionRow | null): CouncilReportTickerMention | null {
  if (!row) return null
  return {
    ticker: row.ticker,
    stance: row.stance,
    recommendationText: row.recommendation_text,
    targetPrice: numberOrNull(row.target_price),
    targetCurrency: row.target_currency,
    rationale: row.rationale,
    evidence: array(row.evidence),
    sourceOpinion: true,
  }
}

function normalizeItem(
  report: ReportRow,
  analysis: AnalysisRow,
  roles: CouncilReportRole[],
  mention: MentionRow | null,
): CouncilReportEvidenceItem {
  return {
    reportId: report.id,
    analysisId: analysis.id,
    provider: report.provider,
    sourceName: report.source_name,
    title: report.title,
    publishDate: report.publish_date,
    category: report.category,
    contentHash: analysis.content_hash,
    analysisVersion: analysis.analysis_version,
    promptVersion: analysis.prompt_version,
    modelRouteKey: analysis.model_route_key,
    processedAt: analysis.processed_at,
    roles,
    executiveSummary: analysis.executive_summary,
    marketView: analysis.market_view,
    sectorOutlook: analysis.sector_outlook,
    catalysts: array(analysis.catalysts),
    risks: array(analysis.risks),
    tickerMention: normalizeMention(mention),
  }
}

async function loadReports(
  client: SupabaseClient,
  params: { asOf: string; runAt: string; lookbackDays: number; categories?: CouncilReportCategory[] },
) {
  let query = db(client)
    .from(REPORT_TABLE)
    .select("id,provider,source_name,title,publish_date,category,created_at") as unknown as {
      lte(column: string, value: string): typeof query
      gte(column: string, value: string): typeof query
      in(column: string, values: unknown[]): typeof query
      limit(value: number): PromiseLike<QueryResult>
    }
  query = query.lte("publish_date", params.asOf)
  query = query.gte("publish_date", dateFloor(params.asOf, params.lookbackDays))
  query = query.lte("created_at", params.runAt)
  if (params.categories?.length) query = query.in("category", params.categories)
  const rows = ensureRows(await query.limit(MAX_QUERY_ROWS), "Council Research Report metadata lookup failed")
  return rows.map(reportRow).filter((row): row is ReportRow => Boolean(row))
}

async function loadAnalyses(client: SupabaseClient, reportIds: string[], runAt: string) {
  if (!reportIds.length) return []
  let query = db(client)
    .from(ANALYSIS_TABLE)
    .select("id,report_id,content_hash,analysis_version,prompt_version,model_route_key,processed_at,executive_summary,market_view,sector_outlook,catalysts,risks") as unknown as {
      in(column: string, values: unknown[]): typeof query
      lte(column: string, value: string): typeof query
      limit(value: number): PromiseLike<QueryResult>
    }
  query = query.in("report_id", reportIds)
  query = query.lte("processed_at", runAt)
  const rows = ensureRows(await query.limit(MAX_QUERY_ROWS), "Council Research Report analysis lookup failed")
  return rows.map(analysisRow).filter((row): row is AnalysisRow => Boolean(row))
}

async function loadMentions(
  client: SupabaseClient,
  analysisIds: string[],
  runAt: string,
  ticker?: string,
) {
  if (!analysisIds.length) return []
  let query = db(client)
    .from(MENTION_TABLE)
    .select("report_id,analysis_id,ticker,stance,recommendation_text,target_price,target_currency,rationale,evidence,created_at") as unknown as {
      in(column: string, values: unknown[]): typeof query
      lte(column: string, value: string): typeof query
      eq(column: string, value: unknown): typeof query
      limit(value: number): PromiseLike<QueryResult>
    }
  query = query.in("analysis_id", analysisIds)
  query = query.lte("created_at", runAt)
  if (ticker) query = query.eq("ticker", ticker.toUpperCase())
  const rows = ensureRows(await query.limit(MAX_QUERY_ROWS), "Council Research Report mention lookup failed")
  return rows.map(mentionRow).filter((row): row is MentionRow => Boolean(row))
}

function tickerSort(left: CouncilReportEvidenceItem, right: CouncilReportEvidenceItem) {
  return compareDesc(left.publishDate, right.publishDate)
    || compareDesc(left.processedAt, right.processedAt)
    || left.reportId.localeCompare(right.reportId)
    || left.analysisId.localeCompare(right.analysisId)
}

function marketSort(left: CouncilReportEvidenceItem, right: CouncilReportEvidenceItem) {
  const rank = (value: CouncilReportCategory) => value === "macro" ? 0 : value === "strategy" ? 1 : 2
  return rank(left.category) - rank(right.category)
    || compareDesc(left.publishDate, right.publishDate)
    || compareDesc(left.processedAt, right.processedAt)
    || left.reportId.localeCompare(right.reportId)
    || left.analysisId.localeCompare(right.analysisId)
}

export async function getRelevantReportEvidence(
  client: SupabaseClient,
  params: {
    ticker: string
    asOf: string
    runAt: string
    tickerLimit?: number
    tickerLookbackDays?: number
  },
): Promise<CouncilReportEvidenceItem[]> {
  const normalizedTicker = params.ticker.trim().toUpperCase()
  const limit = Math.max(0, Math.min(COUNCIL_REPORT_TICKER_LIMIT, params.tickerLimit ?? COUNCIL_REPORT_TICKER_LIMIT))
  if (!normalizedTicker || !limit) return []

  const reports = await loadReports(client, {
    asOf: params.asOf,
    runAt: params.runAt,
    lookbackDays: params.tickerLookbackDays ?? COUNCIL_REPORT_TICKER_LOOKBACK_DAYS,
  })
  const analyses = await loadAnalyses(client, reports.map((row) => row.id), params.runAt)
  const latestByReport = newestEligibleAnalysisByReport(analyses, params.runAt)
  const selectedAnalyses = [...latestByReport.values()]
  const mentions = await loadMentions(client, selectedAnalyses.map((row) => row.id), params.runAt, normalizedTicker)
  const mentionByAnalysis = new Map(mentions.map((row) => [row.analysis_id, row] as const))
  const reportById = new Map(reports.map((row) => [row.id, row] as const))

  return selectedAnalyses
    .map((analysis) => {
      const report = reportById.get(analysis.report_id)
      const mention = mentionByAnalysis.get(analysis.id)
      return report && mention ? normalizeItem(report, analysis, ["ticker"], mention) : null
    })
    .filter((row): row is CouncilReportEvidenceItem => Boolean(row))
    .sort(tickerSort)
    .slice(0, limit)
}

export async function getRelevantMarketReportEvidence(
  client: SupabaseClient,
  params: {
    ticker: string
    asOf: string
    runAt: string
    categories?: Array<"macro" | "strategy">
    marketLimit?: number
    marketLookbackDays?: number
  },
): Promise<CouncilReportEvidenceItem[]> {
  const limit = Math.max(0, Math.min(COUNCIL_REPORT_MARKET_LIMIT, params.marketLimit ?? COUNCIL_REPORT_MARKET_LIMIT))
  if (!limit) return []
  const categories: CouncilReportCategory[] = params.categories?.length ? params.categories : ["macro", "strategy"]
  const reports = await loadReports(client, {
    asOf: params.asOf,
    runAt: params.runAt,
    lookbackDays: params.marketLookbackDays ?? COUNCIL_REPORT_MARKET_LOOKBACK_DAYS,
    categories,
  })
  const analyses = await loadAnalyses(client, reports.map((row) => row.id), params.runAt)
  const latestByReport = newestEligibleAnalysisByReport(analyses, params.runAt)
  const reportById = new Map(reports.map((row) => [row.id, row] as const))

  return [...latestByReport.values()]
    .map((analysis) => {
      const report = reportById.get(analysis.report_id)
      return report ? normalizeItem(report, analysis, ["market"], null) : null
    })
    .filter((row): row is CouncilReportEvidenceItem => Boolean(row))
    .sort(marketSort)
    .slice(0, limit)
}

function clipText(value: string | null, maxChars: number): [string | null, boolean] {
  if (value == null || value.length <= maxChars) return [value, false]
  return [value.slice(0, maxChars), true]
}

function clipUnknown(value: unknown, maxChars: number): [unknown, boolean] {
  if (typeof value === "string") return clipText(value, maxChars)
  const serialized = JSON.stringify(value)
  if (serialized.length <= maxChars) return [value, false]
  return [serialized.slice(0, maxChars), true]
}

function promptSafeItem(item: CouncilReportEvidenceItem) {
  let truncated = false
  const [title, titleCut] = clipText(item.title, 240)
  const [summary, summaryCut] = clipText(item.executiveSummary, 1_200)
  const [marketView, marketCut] = clipText(item.marketView, 500)
  const [sectorOutlook, sectorCut] = clipText(item.sectorOutlook, 500)
  truncated ||= titleCut || summaryCut || marketCut || sectorCut

  const clipList = (values: unknown[]) => values.slice(0, 3).map((value) => {
    const [clipped, cut] = clipUnknown(value, 350)
    truncated ||= cut
    return clipped
  })
  if (item.catalysts.length > 3 || item.risks.length > 3) truncated = true

  let tickerMention = item.tickerMention
  if (tickerMention) {
    const [rationale, rationaleCut] = clipText(tickerMention.rationale, 600)
    const evidence = tickerMention.evidence.slice(0, 3).map((value) => {
      const [clipped, cut] = clipUnknown(value, 450)
      truncated ||= cut
      return clipped
    })
    if (tickerMention.evidence.length > 3) truncated = true
    truncated ||= rationaleCut
    tickerMention = { ...tickerMention, rationale, evidence }
  }

  return {
    item: {
      ...item,
      title: title ?? "",
      executiveSummary: summary ?? "",
      marketView,
      sectorOutlook,
      catalysts: clipList(item.catalysts),
      risks: clipList(item.risks),
      tickerMention,
    },
    truncated,
  }
}

function clampCouncilReportSelection(items: CouncilReportEvidenceItem[]) {
  let truncated = false
  let reports = items.slice(0, COUNCIL_REPORT_TICKER_LIMIT + COUNCIL_REPORT_MARKET_LIMIT).map((item) => {
    const safe = promptSafeItem(item)
    truncated ||= safe.truncated
    return safe.item
  })
  if (items.length > reports.length) truncated = true

  let serialized = JSON.stringify(reports)
  if (serialized.length > COUNCIL_REPORT_MAX_PROMPT_CHARS) {
    truncated = true
    reports = reports.map((item) => ({
      ...item,
      executiveSummary: item.executiveSummary.slice(0, 600),
      marketView: item.marketView?.slice(0, 200) ?? null,
      sectorOutlook: item.sectorOutlook?.slice(0, 200) ?? null,
      catalysts: item.catalysts.slice(0, 1),
      risks: item.risks.slice(0, 1),
      tickerMention: item.tickerMention
        ? { ...item.tickerMention, rationale: item.tickerMention.rationale?.slice(0, 250) ?? null, evidence: item.tickerMention.evidence.slice(0, 1) }
        : null,
    }))
    serialized = JSON.stringify(reports)
  }

  if (serialized.length > COUNCIL_REPORT_MAX_PROMPT_CHARS) {
    reports = reports.map((item) => ({
      ...item,
      executiveSummary: item.executiveSummary.slice(0, 240),
      marketView: null,
      sectorOutlook: null,
      catalysts: [],
      risks: [],
      tickerMention: item.tickerMention
        ? { ...item.tickerMention, rationale: null, evidence: [] }
        : null,
    }))
    serialized = JSON.stringify(reports)
  }

  while (reports.length && serialized.length > COUNCIL_REPORT_MAX_PROMPT_CHARS) {
    reports = reports.slice(0, -1)
    truncated = true
    serialized = JSON.stringify(reports)
  }

  return { reports, truncated, promptChars: serialized.length }
}

export async function selectCouncilReportEvidence(
  client: SupabaseClient,
  params: { ticker: string; asOf: string; runAt: string },
): Promise<CouncilReportEvidenceSelection> {
  const [tickerReports, marketReports] = await Promise.all([
    getRelevantReportEvidence(client, params),
    getRelevantMarketReportEvidence(client, params),
  ])

  const deduped = new Map<string, CouncilReportEvidenceItem>()
  for (const item of [...tickerReports, ...marketReports]) {
    const key = `${item.reportId}|${item.analysisId}`
    const existing = deduped.get(key)
    if (!existing) {
      deduped.set(key, item)
      continue
    }
    const roles: CouncilReportRole[] = ["ticker", "market"].filter((role) => existing.roles.includes(role as CouncilReportRole) || item.roles.includes(role as CouncilReportRole)) as CouncilReportRole[]
    deduped.set(key, {
      ...existing,
      roles,
      tickerMention: existing.tickerMention ?? item.tickerMention,
    })
  }

  const clamped = clampCouncilReportSelection([...deduped.values()])
  return {
    ticker: params.ticker.trim().toUpperCase(),
    asOf: params.asOf,
    runAt: params.runAt,
    ...clamped,
  }
}
