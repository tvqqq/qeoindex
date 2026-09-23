import type { ResearchReportCategory } from "./types.ts"

const REPORT_TABLE = "market_research_reports"
const ANALYSIS_TABLE = "market_research_report_analyses"
const MENTION_TABLE = "market_research_report_ticker_mentions"
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000"
const MAX_ERROR_CHARS = 500
const MAX_SEARCH_CHARS = 100
const MAX_SOURCE_CHARS = 80
const MAX_TICKER_CHARS = 12
const MAX_DESCRIPTION_CHARS = 280

export const RESEARCH_REPORT_CATALOG_PAGE_SIZE = 24
export const RESEARCH_REPORT_CATALOG_CATEGORIES = ["macro", "strategy", "sector"] as const

export type ResearchReportCatalogCategory = (typeof RESEARCH_REPORT_CATALOG_CATEGORIES)[number]

export interface ResearchReportCatalogQuery {
  category: ResearchReportCatalogCategory | null
  search: string
  source: string
  ticker: string
  fromDate: string | null
  toDate: string | null
  page: number
}

export interface ResearchReportCatalogItem {
  id: string
  title: string
  description: string | null
  sourceName: string
  publishDate: string
  category: ResearchReportCategory
  sectorName: string | null
  recommendation: string | null
  targetPrice: number | null
  code: string | null
  ingestionStatus: string
  analysisStatus: string
  summaryImageStatus: string
  summaryImageGeneratedAt: string | null
  relatedTickers: string[]
}

export interface ResearchReportCatalogResult {
  query: ResearchReportCatalogQuery
  items: ResearchReportCatalogItem[]
  total: number
  pageSize: number
  totalPages: number
  lastSuccessfulSyncAt: string | null
  hasDegradedRows: boolean
}

interface CatalogQueryResult {
  data: Record<string, unknown>[] | null
  error: { message?: string } | null
  count: number | null
}

interface CatalogSingleResult {
  data: Record<string, unknown> | null
  error: { message?: string } | null
}

interface CatalogQueryBuilder extends PromiseLike<CatalogQueryResult> {
  select(columns: string, options?: { count?: "exact" }): CatalogQueryBuilder
  eq(column: string, value: unknown): CatalogQueryBuilder
  in(column: string, values: unknown[]): CatalogQueryBuilder
  gte(column: string, value: unknown): CatalogQueryBuilder
  lte(column: string, value: unknown): CatalogQueryBuilder
  or(filters: string): CatalogQueryBuilder
  order(column: string, options: { ascending: boolean }): CatalogQueryBuilder
  range(from: number, to: number): CatalogQueryBuilder
  limit(count: number): CatalogQueryBuilder
  maybeSingle(): PromiseLike<CatalogSingleResult>
}

export interface ResearchReportCatalogClient {
  from(table: string): unknown
}

function sanitizeErrorMessage(value: string | null | undefined): string {
  let sanitized = String(value ?? "unknown Supabase error")
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (apiKey) sanitized = sanitized.split(apiKey).join("[REDACTED]")

  return sanitized
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_CHARS)
}

function supabaseError(prefix: string, error: { message?: string } | null): Error {
  return new Error(`${prefix}: ${sanitizeErrorMessage(error?.message)}`.slice(0, MAX_ERROR_CHARS))
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? ""
}

function normalizedText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength)
}

function normalizedSearch(value: string): string {
  return normalizedText(value, MAX_SEARCH_CHARS)
    .replace(/[,%_()\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizedIsoDate(value: string): string | null {
  const candidate = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null
  const parsed = new Date(`${candidate}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate) return null
  return candidate
}

function normalizedPage(value: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.min(parsed, 500)
}

export function normalizeResearchReportCatalogQuery(raw: {
  category?: string | string[]
  q?: string | string[]
  source?: string | string[]
  ticker?: string | string[]
  from?: string | string[]
  to?: string | string[]
  page?: string | string[]
}): ResearchReportCatalogQuery {
  const rawCategory = normalizedText(first(raw.category), 20).toLowerCase()
  const category = RESEARCH_REPORT_CATALOG_CATEGORIES.includes(rawCategory as ResearchReportCatalogCategory)
    ? rawCategory as ResearchReportCatalogCategory
    : null
  const search = normalizedSearch(first(raw.q))
  const source = normalizedText(first(raw.source), MAX_SOURCE_CHARS)
  const tickerCandidate = normalizedText(first(raw.ticker), MAX_TICKER_CHARS).toUpperCase()
  const ticker = /^[A-Z0-9]{2,12}$/.test(tickerCandidate) ? tickerCandidate : ""
  let fromDate = normalizedIsoDate(first(raw.from))
  let toDate = normalizedIsoDate(first(raw.to))
  if (fromDate && toDate && fromDate > toDate) [fromDate, toDate] = [toDate, fromDate]

  return {
    category,
    search,
    source,
    ticker,
    fromDate,
    toDate,
    page: normalizedPage(first(raw.page)),
  }
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function catalogDescription(value: unknown): string | null {
  const summary = nonEmptyString(value)
  if (!summary) return null
  return normalizedText(summary, MAX_DESCRIPTION_CHARS)
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function reportCategory(value: unknown): ResearchReportCategory {
  return value === "macro" || value === "strategy" || value === "sector" || value === "other"
    ? value
    : "other"
}

function toCatalogItem(row: Record<string, unknown>): ResearchReportCatalogItem | null {
  const id = nonEmptyString(row.id)
  const title = nonEmptyString(row.title)
  const sourceName = nonEmptyString(row.source_name)
  const publishDate = nonEmptyString(row.publish_date)
  if (!id || !title || !sourceName || !publishDate) return null

  return {
    id,
    title,
    description: null,
    sourceName,
    publishDate,
    category: reportCategory(row.category),
    sectorName: nonEmptyString(row.sector_name),
    recommendation: nonEmptyString(row.recommendation),
    targetPrice: finiteNumber(row.target_price),
    code: nonEmptyString(row.code)?.toUpperCase() ?? null,
    ingestionStatus: nonEmptyString(row.ingestion_status) ?? "discovered",
    analysisStatus: nonEmptyString(row.analysis_status) ?? "pending",
    summaryImageStatus: nonEmptyString(row.summary_image_status) ?? "pending",
    summaryImageGeneratedAt: nonEmptyString(row.summary_image_generated_at),
    relatedTickers: [],
  }
}

export async function getResearchReportCatalog(
  client: ResearchReportCatalogClient,
  rawQuery: Parameters<typeof normalizeResearchReportCatalogQuery>[0],
): Promise<ResearchReportCatalogResult> {
  const query = normalizeResearchReportCatalogQuery(rawQuery)
  const offset = (query.page - 1) * RESEARCH_REPORT_CATALOG_PAGE_SIZE

  let tickerReportIds: string[] | null = null
  if (query.ticker) {
    const [mentionResult, directCodeResult] = await Promise.all([
      (client.from(MENTION_TABLE) as CatalogQueryBuilder)
        .select("report_id")
        .eq("ticker", query.ticker)
        .limit(2000),
      (client.from(REPORT_TABLE) as CatalogQueryBuilder)
        .select("id")
        .eq("code", query.ticker)
        .limit(2000),
    ])
    if (mentionResult.error) throw supabaseError("Research report ticker filter lookup failed", mentionResult.error)
    if (directCodeResult.error) throw supabaseError("Research report code filter lookup failed", directCodeResult.error)

    tickerReportIds = [...new Set([
      ...(mentionResult.data ?? []).map((row) => nonEmptyString(row.report_id)),
      ...(directCodeResult.data ?? []).map((row) => nonEmptyString(row.id)),
    ].filter((value): value is string => value !== null))]
  }

  let builder = (client.from(REPORT_TABLE) as CatalogQueryBuilder)
    .select(
      "id,title,source_name,publish_date,category,sector_name,recommendation,target_price,code,ingestion_status,analysis_status,content_hash,summary_image_status,summary_image_generated_at",
      { count: "exact" },
    )

  if (tickerReportIds) {
    builder = tickerReportIds.length > 0
      ? builder.in("id", tickerReportIds)
      : builder.eq("id", EMPTY_UUID)
  }
  if (query.category) builder = builder.eq("category", query.category)
  if (query.source) builder = builder.eq("source_name", query.source)
  if (query.fromDate) builder = builder.gte("publish_date", query.fromDate)
  if (query.toDate) builder = builder.lte("publish_date", query.toDate)
  if (query.search) {
    const pattern = `%${query.search}%`
    builder = builder.or(`title.ilike.${pattern},source_name.ilike.${pattern},sector_name.ilike.${pattern}`)
  }

  const result = await builder
    .order("publish_date", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + RESEARCH_REPORT_CATALOG_PAGE_SIZE - 1)

  if (result.error) throw supabaseError("Research report catalog lookup failed", result.error)

  const syncResult = await (client.from(REPORT_TABLE) as CatalogQueryBuilder)
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (syncResult.error) throw supabaseError("Research report catalog sync lookup failed", syncResult.error)

  const reportEntries = (result.data ?? [])
    .map((row) => {
      const item = toCatalogItem(row)
      if (!item) return null
      return { item, contentHash: nonEmptyString(row.content_hash) }
    })
    .filter((entry): entry is { item: ResearchReportCatalogItem; contentHash: string | null } => entry !== null)

  const currentContentHashes = new Map(
    reportEntries
      .filter((entry): entry is { item: ResearchReportCatalogItem; contentHash: string } => Boolean(entry.contentHash))
      .map((entry) => [entry.item.id, entry.contentHash]),
  )
  const analyzedReportIds = reportEntries
    .filter((entry) => entry.item.analysisStatus === "ready" && entry.contentHash)
    .map((entry) => entry.item.id)
  const descriptions = new Map<string, string>()
  const currentAnalysisIds = new Map<string, string>()

  if (analyzedReportIds.length > 0) {
    const analysisResult = await (client.from(ANALYSIS_TABLE) as CatalogQueryBuilder)
      .select("id,report_id,content_hash,executive_summary,processed_at,created_at")
      .in("report_id", analyzedReportIds)
      .order("processed_at", { ascending: false })
      .order("created_at", { ascending: false })

    if (!analysisResult.error) {
      for (const row of analysisResult.data ?? []) {
        const analysisId = nonEmptyString(row.id)
        const reportId = nonEmptyString(row.report_id)
        const contentHash = nonEmptyString(row.content_hash)
        if (!analysisId || !reportId || !contentHash || currentAnalysisIds.has(reportId)) continue
        if (currentContentHashes.get(reportId) !== contentHash) continue
        currentAnalysisIds.set(reportId, analysisId)
        const description = catalogDescription(row.executive_summary)
        if (description) descriptions.set(reportId, description)
      }
    }
  }

  const reportIdByAnalysisId = new Map(
    [...currentAnalysisIds.entries()].map(([reportId, analysisId]) => [analysisId, reportId]),
  )
  const relatedTickers = new Map<string, string[]>()
  const currentAnalysisIdList = [...reportIdByAnalysisId.keys()]
  if (currentAnalysisIdList.length > 0) {
    const mentionResult = await (client.from(MENTION_TABLE) as CatalogQueryBuilder)
      .select("analysis_id,ticker")
      .in("analysis_id", currentAnalysisIdList)
      .order("ticker", { ascending: true })

    if (!mentionResult.error) {
      for (const row of mentionResult.data ?? []) {
        const analysisId = nonEmptyString(row.analysis_id)
        const ticker = nonEmptyString(row.ticker)?.toUpperCase() ?? ""
        const reportId = analysisId ? reportIdByAnalysisId.get(analysisId) : null
        if (!reportId || !/^[A-Z0-9]{2,12}$/.test(ticker)) continue
        const list = relatedTickers.get(reportId) ?? []
        if (!list.includes(ticker) && list.length < 8) list.push(ticker)
        relatedTickers.set(reportId, list)
      }
    }
  }

  const items = reportEntries.map(({ item }) => {
    const tickerList = relatedTickers.get(item.id) ?? []
    const directCode = item.code && /^[A-Z0-9]{2,12}$/.test(item.code) ? item.code : null
    return {
      ...item,
      description: descriptions.get(item.id) ?? null,
      relatedTickers: directCode && !tickerList.includes(directCode)
        ? [directCode, ...tickerList].slice(0, 8)
        : tickerList,
    }
  })
  const total = Math.max(0, result.count ?? items.length)
  const lastSuccessfulSyncAt = nonEmptyString(syncResult.data?.updated_at)

  return {
    query,
    items,
    total,
    pageSize: RESEARCH_REPORT_CATALOG_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / RESEARCH_REPORT_CATALOG_PAGE_SIZE)),
    lastSuccessfulSyncAt,
    hasDegradedRows: items.some((item) =>
      item.ingestionStatus === "failed"
      || item.ingestionStatus === "needs_ocr"
      || item.ingestionStatus === "unsupported"
      || item.analysisStatus === "failed"
    ),
  }
}
