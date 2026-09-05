import type {
  ResearchReportCategory,
  ResearchReportDiscoveryBoundaryReason,
  ResearchReportDiscoveryResult,
  ResearchReportSourceRecord,
} from "../types.ts"

export const TOPI_ANALYSIS_REPORT_URL = "https://apiclient.topi.vn/api-web/AnalysisReport"

const DEFAULT_PAGE_SIZE = 15
const DEFAULT_MAX_PAGES = 20
const DEFAULT_TIMEOUT_MS = 10_000
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replaceAll(",", ""))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export function normalizeTopiReportCategory(typeReport: string | null | undefined): ResearchReportCategory {
  if (!typeReport) return "other"
  const normalized = normalizeSearchText(typeReport)
  if (normalized.includes("vi mo") || normalized.includes("tien te")) return "macro"
  if (normalized.includes("chien luoc")) return "strategy"
  if (normalized.includes("nganh")) return "sector"
  return "other"
}

function parsePublishDate(value: unknown): string {
  const text = readString(value)
  if (!text) throw new Error("TOPI report publish_date is missing")

  const viDate = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text)
  if (viDate) return `${viDate[3]}-${viDate[2]}-${viDate[1]}`

  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (isoDate) return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`

  throw new Error(`Unsupported TOPI publish_date: ${text}`)
}

function readSectorName(value: unknown): string | null {
  const direct = readString(value)
  if (direct) return direct
  const record = asRecord(value)
  if (!record) return null
  return readString(record.name) ?? readString(record.sector_name) ?? readString(record.sectorName)
}

function readExternalReportId(record: Record<string, unknown>): string {
  const raw = record.reportId ?? record.report_id ?? record.id
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw)
  const text = readString(raw)
  if (text) return text
  throw new Error("TOPI reportId is missing")
}

export function parseTopiReport(value: unknown): ResearchReportSourceRecord {
  const record = asRecord(value)
  if (!record) throw new Error("TOPI report payload must be an object")

  const title = readString(record.name) ?? readString(record.title)
  if (!title) throw new Error("TOPI report name is missing")

  const sourceName = readString(record.source_name) ?? readString(record.sourceName)
  if (!sourceName) throw new Error("TOPI report source_name is missing")

  const pdfUrl = readString(record.url)
  if (!pdfUrl) throw new Error("TOPI report PDF url is missing")

  const originalTypeReport = readString(record.type_report) ?? readString(record.typeReport)
  const rawTargetPrice = readFiniteNumber(record.target_price ?? record.targetPrice)

  return {
    provider: "topi",
    externalReportId: readExternalReportId(record),
    title,
    sourceName,
    publishDate: parsePublishDate(record.publish_date ?? record.publishDate),
    originalTypeReport,
    category: normalizeTopiReportCategory(originalTypeReport),
    sectorName: readSectorName(record.sector),
    recommendation: readString(record.recommended ?? record.recommendation),
    targetPrice: rawTargetPrice !== null && rawTargetPrice > 0 ? rawTargetPrice : null,
    code: readString(record.code)?.toUpperCase() ?? null,
    link: readString(record.link),
    pdfUrl,
    sourcePayload: { ...record },
  }
}

function findReportRows(value: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(value)) return value
  if (depth > 4) return null
  const record = asRecord(value)
  if (!record) return null

  for (const key of ["list", "items", "results", "records", "data", "result"]) {
    if (!(key in record)) continue
    const rows = findReportRows(record[key], depth + 1)
    if (rows) return rows
  }
  return null
}

export interface FetchTopiReportsPageOptions {
  page: number
  limit?: number
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export async function fetchTopiReportsPage({
  page,
  limit = DEFAULT_PAGE_SIZE,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: FetchTopiReportsPageOptions): Promise<ResearchReportSourceRecord[]> {
  if (!Number.isInteger(page) || page < 1) throw new Error("TOPI page must be a positive integer")
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("TOPI limit must be between 1 and 100")

  const response = await fetchImpl(TOPI_ANALYSIS_REPORT_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      page,
      limit,
      from_date: "",
      to_date: "",
      type: 0,
      source_name: "",
      sectorId: "",
      platform: "Web",
    }),
  })

  if (!response.ok) throw new Error(`TOPI AnalysisReport failed (${response.status})`)
  const payload = await response.json() as unknown
  const rows = findReportRows(payload)
  if (!rows) throw new Error("TOPI AnalysisReport response does not contain a report list")
  return rows.map(parseTopiReport)
}

export interface DiscoverTopiReportsOptions {
  knownExternalReportIds?: ReadonlySet<string>
  recentPublishDateFloor?: string
  fetchImpl?: typeof fetch
  pageSize?: number
  maxPages?: number
  timeoutMs?: number
}

function discoveryResult(
  reports: ResearchReportSourceRecord[],
  pagesFetched: number,
  stoppedAtKnownBoundary: boolean,
  boundaryReason: ResearchReportDiscoveryBoundaryReason,
  reachedSafetyLimit = false,
): ResearchReportDiscoveryResult {
  return { reports, pagesFetched, stoppedAtKnownBoundary, boundaryReason, reachedSafetyLimit }
}

export async function discoverTopiReports({
  knownExternalReportIds = new Set<string>(),
  recentPublishDateFloor,
  fetchImpl = fetch,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: DiscoverTopiReportsOptions = {}): Promise<ResearchReportDiscoveryResult> {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) {
    throw new Error("TOPI maxPages must be between 1 and 100")
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error("TOPI pageSize must be between 1 and 100")
  }
  if (recentPublishDateFloor && !ISO_DATE_RE.test(recentPublishDateFloor)) {
    throw new Error("TOPI recentPublishDateFloor must be YYYY-MM-DD")
  }

  const reports: ResearchReportSourceRecord[] = []
  const seen = new Set<string>()
  let pagesFetched = 0
  let lastPageWasFull = false

  for (let page = 1; page <= maxPages; page += 1) {
    const pageReports = await fetchTopiReportsPage({ page, limit: pageSize, fetchImpl, timeoutMs })
    pagesFetched += 1
    lastPageWasFull = pageReports.length >= pageSize

    if (pageReports.length === 0) {
      return discoveryResult(reports, pagesFetched, false, "empty_page")
    }

    if (!recentPublishDateFloor) {
      for (const report of pageReports) {
        if (knownExternalReportIds.has(report.externalReportId)) {
          return discoveryResult(reports, pagesFetched, true, "known_id")
        }
        if (seen.has(report.externalReportId)) continue
        seen.add(report.externalReportId)
        reports.push(report)
      }
      if (pageReports.length < pageSize) {
        return discoveryResult(reports, pagesFetched, false, "short_page")
      }
      continue
    }

    const knownOldBoundary = pageReports.length >= pageSize && pageReports.every((report) =>
      knownExternalReportIds.has(report.externalReportId) && report.publishDate < recentPublishDateFloor)

    if (knownOldBoundary) {
      return discoveryResult(reports, pagesFetched, true, "known_old_page")
    }

    for (const report of pageReports) {
      if (seen.has(report.externalReportId)) continue
      seen.add(report.externalReportId)
      reports.push(report)
    }

    if (pageReports.length < pageSize) {
      return discoveryResult(reports, pagesFetched, false, "short_page")
    }
  }

  return discoveryResult(reports, pagesFetched, false, "max_pages", lastPageWasFull)
}
