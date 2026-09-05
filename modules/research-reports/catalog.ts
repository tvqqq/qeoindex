import type { ResearchReportCategory } from "./types.ts"

const REPORT_TABLE = "market_research_reports"
const MAX_ERROR_CHARS = 500
const MAX_SEARCH_CHARS = 100
const MAX_SOURCE_CHARS = 80

export const RESEARCH_REPORT_CATALOG_PAGE_SIZE = 20
export const RESEARCH_REPORT_CATALOG_CATEGORIES = ["macro", "strategy", "sector"] as const

export type ResearchReportCatalogCategory = (typeof RESEARCH_REPORT_CATALOG_CATEGORIES)[number]

export interface ResearchReportCatalogQuery {
  category: ResearchReportCatalogCategory | null
  search: string
  source: string
  fromDate: string | null
  toDate: string | null
  page: number
}

export interface ResearchReportCatalogItem {
  id: string
  title: string
  sourceName: string
  publishDate: string
  category: ResearchReportCategory
  sectorName: string | null
  recommendation: string | null
  targetPrice: number | null
  code: string | null
  ingestionStatus: string
  analysisStatus: string
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
  let fromDate = normalizedIsoDate(first(raw.from))
  let toDate = normalizedIsoDate(first(raw.to))
  if (fromDate && toDate && fromDate > toDate) [fromDate, toDate] = [toDate, fromDate]

  return {
    category,
    search,
    source,
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
    sourceName,
    publishDate,
    category: reportCategory(row.category),
    sectorName: nonEmptyString(row.sector_name),
    recommendation: nonEmptyString(row.recommendation),
    targetPrice: finiteNumber(row.target_price),
    code: nonEmptyString(row.code),
    ingestionStatus: nonEmptyString(row.ingestion_status) ?? "discovered",
    analysisStatus: nonEmptyString(row.analysis_status) ?? "pending",
  }
}

export async function getResearchReportCatalog(
  client: ResearchReportCatalogClient,
  rawQuery: Parameters<typeof normalizeResearchReportCatalogQuery>[0],
): Promise<ResearchReportCatalogResult> {
  const query = normalizeResearchReportCatalogQuery(rawQuery)
  const offset = (query.page - 1) * RESEARCH_REPORT_CATALOG_PAGE_SIZE

  let builder = (client.from(REPORT_TABLE) as CatalogQueryBuilder)
    .select(
      "id,title,source_name,publish_date,category,sector_name,recommendation,target_price,code,ingestion_status,analysis_status",
      { count: "exact" },
    )

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

  const items = (result.data ?? [])
    .map(toCatalogItem)
    .filter((item): item is ResearchReportCatalogItem => item !== null)
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
