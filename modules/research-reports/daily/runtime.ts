import {
  createResearchReportAiBudget,
  type ResearchReportAiBudget,
  type ResearchReportAiBudgetSnapshot,
} from "../analysis/budget.ts"
import { processResearchReport } from "../analysis/pipeline.ts"
import { discoverTopiReports } from "../providers/topi.ts"
import { upsertResearchReports } from "../repository.ts"
import type { ProcessResearchReportResult, ResearchReportSourceRecord } from "../types.ts"
import type { ResearchReportWorkflowCandidate, ResearchReportsWorkflowMode } from "./orchestrator.ts"
import {
  persistResearchReportRunItemStep,
  updateResearchReportsPhaseStep,
  type ResearchReportAttemptUsage,
  type ResearchReportRunItemEvidence,
} from "./telemetry.ts"

export const DAILY_PAGE_SIZE = 15
export const DAILY_MAX_PAGES = 8
export const BACKFILL_MAX_PAGES = 20
export const DAILY_MAX_REPORTS = 20
export const BACKFILL_MAX_REPORTS = 100
export const BACKFILL_MAX_DAYS = 90
export const DAILY_RECENT_RESCAN_DAYS = 30
export const RESEARCH_REPORT_MAX_AI_REQUESTS = 20
export const RESEARCH_REPORT_MAX_AI_COST_USD = 1
export const RESEARCH_REPORT_AI_MAX_RETRIES_PER_REPORT = 3
export const RESEARCH_REPORT_AI_MAX_ATTEMPTS_PER_REPORT = RESEARCH_REPORT_AI_MAX_RETRIES_PER_REPORT + 1
export const REPORT_PROCESSING_MAX_ATTEMPTS = 3

interface DbError { message?: string }
interface DbResult { data: unknown; error: DbError | null }
interface DbQuery extends PromiseLike<DbResult> {
  select(columns: string): DbQuery
  eq(column: string, value: unknown): DbQuery
  in(column: string, values: readonly unknown[]): DbQuery
  order(column: string, options?: { ascending?: boolean }): DbQuery
  limit(value: number): DbQuery
}
interface ResearchReportsDb {
  from(table: string): DbQuery
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>
}

interface ExistingReportRow {
  id: string
  provider: "topi"
  external_report_id: string
  publish_date: string
  title: string
  source_name: string
  original_type_report: string | null
  category: string
  sector_name: string | null
  recommendation: string | null
  target_price: number | null
  code: string | null
  link: string | null
  pdf_url: string
  ingestion_status: string
  analysis_status: string
}

export interface PreparedResearchReportsRun {
  candidates: ResearchReportWorkflowCandidate[]
  discovered: number
  newCount: number
  changedCount: number
  unchangedCount: number
  deferredReportLimit: number
  pagesFetched: number
  boundaryReason: string
  hitDiscoverySafetyLimit: boolean
  recentPublishDateFloor: string
}

export interface ProcessResearchReportRunStepResult {
  result: ProcessResearchReportResult
  outcome: ResearchReportRunItemEvidence["outcome"]
  budgetSnapshot: ResearchReportAiBudgetSnapshot
  usage: ResearchReportAttemptUsage
}

function parseIsoDate(value: string, name: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be YYYY-MM-DD`)
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} must be a valid calendar date`)
  }
  return date
}

function isoDateDaysBefore(isoTimestamp: string, days: number) {
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) throw new Error("Research Reports workflow start time is invalid")
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function validateBackfillRange(fromDate?: string, toDate?: string) {
  if (Boolean(fromDate) !== Boolean(toDate)) {
    throw new Error("Research Reports backfill requires both fromDate and toDate when a date range is provided")
  }
  if (!fromDate || !toDate) return
  const from = parseIsoDate(fromDate, "fromDate")
  const to = parseIsoDate(toDate, "toDate")
  if (from.getTime() > to.getTime()) throw new Error("Research Reports toDate must be on or after fromDate")
  const spanDays = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1
  if (spanDays > BACKFILL_MAX_DAYS) {
    throw new Error(`Research Reports backfill range cannot exceed ${BACKFILL_MAX_DAYS} days`)
  }
}

async function getResearchReportsDb(): Promise<ResearchReportsDb> {
  const { getSupabaseServerClient } = await import("../../shared/supabase/server.ts")
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured for Research Reports runtime")
  return supabase as unknown as ResearchReportsDb
}

function rowsFrom(data: unknown): ExistingReportRow[] {
  return Array.isArray(data) ? data as ExistingReportRow[] : []
}

function safeDbError(prefix: string, error: DbError | null) {
  if (!error) return
  throw new Error(`${prefix}: ${String(error.message || "unknown").replace(/\s+/g, " ").slice(0, 300)}`)
}

function reportFingerprint(report: ResearchReportSourceRecord) {
  return JSON.stringify([
    report.publishDate, report.title, report.sourceName, report.originalTypeReport, report.category,
    report.sectorName, report.recommendation, report.targetPrice, report.code, report.link, report.pdfUrl,
  ])
}

function rowFingerprint(row: ExistingReportRow) {
  return JSON.stringify([
    row.publish_date, row.title, row.source_name, row.original_type_report, row.category,
    row.sector_name, row.recommendation, row.target_price, row.code, row.link, row.pdf_url,
  ])
}

function emptyUsage(): ResearchReportAttemptUsage {
  return {
    attemptedModels: [], aiRequestCount: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0,
    outputTokens: 0, reasoningTokens: 0, totalTokens: 0, unknownUsageAttempts: 0,
    estimatedCostUsd: 0, pricingVersion: "",
  }
}

export function createPerReportAiRetryBudget(runBudget: ResearchReportAiBudget): ResearchReportAiBudget {
  let reportAttempts = 0

  return {
    beforeRequest(input) {
      if (reportAttempts >= RESEARCH_REPORT_AI_MAX_ATTEMPTS_PER_REPORT) {
        throw new Error(
          `Research report AI retry limit exhausted after ${RESEARCH_REPORT_AI_MAX_RETRIES_PER_REPORT} retries`,
        )
      }
      runBudget.beforeRequest(input)
      reportAttempts += 1
    },
    recordResponseCost(estimatedCostUsd) {
      runBudget.recordResponseCost(estimatedCostUsd)
    },
    recordUnknownUsage() {
      runBudget.recordUnknownUsage()
    },
    snapshot() {
      return runBudget.snapshot()
    },
  }
}

function classifyOutcome(result: ProcessResearchReportResult, budget: ResearchReportAiBudgetSnapshot): ResearchReportRunItemEvidence["outcome"] {
  if (result.status === "failed" && budget.budgetExhausted) return "deferred_budget"
  return result.status
}

export function isRetryableResearchReportFailure(result: ProcessResearchReportResult) {
  if (result.status !== "failed") return false
  return /\b(408|429|5\d\d)\b|timeout|timed out|AbortError|transport|fetch failed|network|ECONNRESET|ENETUNREACH|EAI_AGAIN/i.test(result.detail)
}

async function retryDelay(attempt: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, Math.min(2_000, 350 * 2 ** Math.max(0, attempt - 1))))
}

export async function prepareResearchReportsRunStep(input: {
  runId: string
  startedAt: string
  mode?: ResearchReportsWorkflowMode
  fromDate?: string
  toDate?: string
  maxReports?: number
}): Promise<PreparedResearchReportsRun> {
  "use step"
  const db = await getResearchReportsDb()
  const mode = input.mode ?? "daily"
  if (mode === "backfill") validateBackfillRange(input.fromDate, input.toDate)

  const hardMaxReports = mode === "backfill" ? BACKFILL_MAX_REPORTS : DAILY_MAX_REPORTS
  const maxReports = input.maxReports ?? DAILY_MAX_REPORTS
  if (!Number.isInteger(maxReports) || maxReports < 1 || maxReports > hardMaxReports) {
    throw new Error(`Research Reports maxReports must be between 1 and ${hardMaxReports}`)
  }

  const recentPublishDateFloor = mode === "backfill"
    ? input.fromDate ?? isoDateDaysBefore(input.startedAt, BACKFILL_MAX_DAYS)
    : isoDateDaysBefore(input.startedAt, DAILY_RECENT_RESCAN_DAYS)
  const toDate = mode === "backfill" ? input.toDate : undefined
  const maxPages = mode === "backfill" ? BACKFILL_MAX_PAGES : DAILY_MAX_PAGES

  await updateResearchReportsPhaseStep({ runId: input.runId, phase: "DISCOVER", status: "running" })
  const knownResult = await db.from("market_research_reports")
    .select("id,provider,external_report_id,publish_date,title,source_name,original_type_report,category,sector_name,recommendation,target_price,code,link,pdf_url,ingestion_status,analysis_status")
    .eq("provider", "topi")
    .order("publish_date", { ascending: false })
    .limit(1000)
  safeDbError("Research Reports known metadata lookup failed", knownResult.error)
  const existingRows = rowsFrom(knownResult.data)
  const knownExternalReportIds = new Set(existingRows.map((row) => row.external_report_id))
  const beforeByExternalId = new Map(existingRows.map((row) => [row.external_report_id, row]))

  const discovery = await discoverTopiReports({
    knownExternalReportIds,
    recentPublishDateFloor,
    fromDate: mode === "backfill" ? input.fromDate : undefined,
    toDate: mode === "backfill" ? input.toDate : undefined,
    pageSize: DAILY_PAGE_SIZE,
    maxPages,
  })
  const scopedReports = discovery.reports.filter((report) =>
    report.publishDate >= recentPublishDateFloor && (!toDate || report.publishDate <= toDate))

  await updateResearchReportsPhaseStep({
    runId: input.runId,
    phase: "DISCOVER",
    status: "succeeded",
    summary: {
      pagesFetched: discovery.pagesFetched,
      discovered: scopedReports.length,
      boundaryReason: discovery.boundaryReason,
      hitSafetyLimit: discovery.reachedSafetyLimit,
      recentPublishDateFloor,
      toDate: toDate ?? null,
      maxPages,
    },
  })

  await updateResearchReportsPhaseStep({ runId: input.runId, phase: "UPSERT_METADATA", status: "running" })
  await upsertResearchReports(db as unknown as Parameters<typeof upsertResearchReports>[0], scopedReports)

  let newCount = 0
  let changedCount = 0
  let unchangedCount = 0
  for (const report of scopedReports) {
    const before = beforeByExternalId.get(report.externalReportId)
    if (!before) newCount += 1
    else if (rowFingerprint(before) !== reportFingerprint(report)) changedCount += 1
    else unchangedCount += 1
  }

  const externalIds = scopedReports.map((report) => report.externalReportId)
  let persistedRows: ExistingReportRow[] = []
  if (externalIds.length > 0) {
    const persistedResult = await db.from("market_research_reports")
      .select("id,provider,external_report_id,publish_date,title,source_name,original_type_report,category,sector_name,recommendation,target_price,code,link,pdf_url,ingestion_status,analysis_status")
      .eq("provider", "topi")
      .in("external_report_id", externalIds)
      .limit(BACKFILL_MAX_PAGES * DAILY_PAGE_SIZE)
    safeDbError("Research Reports persisted metadata lookup failed", persistedResult.error)
    persistedRows = rowsFrom(persistedResult.data)
  }

  const persistedByExternalId = new Map(persistedRows.map((row) => [row.external_report_id, row]))
  const allCandidates = scopedReports.flatMap<ResearchReportWorkflowCandidate>((report) => {
    const persisted = persistedByExternalId.get(report.externalReportId)
    if (!persisted) return []
    return [{ id: persisted.id, provider: "topi", externalReportId: persisted.external_report_id, publishDate: persisted.publish_date, pdfUrl: persisted.pdf_url }]
  })
  const candidates = allCandidates.slice(0, maxReports)
  const deferredReportLimit = Math.max(0, allCandidates.length - candidates.length)

  await updateResearchReportsPhaseStep({
    runId: input.runId,
    phase: "UPSERT_METADATA",
    status: "succeeded",
    summary: { upserted: scopedReports.length, newCount, changedCount, unchangedCount, candidates: candidates.length, deferredReportLimit },
  })

  return {
    candidates, discovered: scopedReports.length, newCount, changedCount, unchangedCount,
    deferredReportLimit, pagesFetched: discovery.pagesFetched, boundaryReason: discovery.boundaryReason,
    hitDiscoverySafetyLimit: discovery.reachedSafetyLimit, recentPublishDateFloor,
  }
}

export async function processResearchReportRunStep(input: {
  runId: string
  jobKey: string
  candidate: ResearchReportWorkflowCandidate
  budgetSnapshot: ResearchReportAiBudgetSnapshot
}): Promise<ProcessResearchReportRunStepResult> {
  "use step"
  const db = await getResearchReportsDb()
  const startedAt = new Date().toISOString()
  const budget = createResearchReportAiBudget({
    maxRequestAttempts: RESEARCH_REPORT_MAX_AI_REQUESTS,
    maxEstimatedCostUsd: RESEARCH_REPORT_MAX_AI_COST_USD,
    initialSnapshot: input.budgetSnapshot,
  })
  const reportBudget = createPerReportAiRetryBudget(budget)
  const usage = emptyUsage()

  let result: ProcessResearchReportResult | null = null
  for (let attempt = 1; attempt <= REPORT_PROCESSING_MAX_ATTEMPTS; attempt += 1) {
    result = await processResearchReport(
      db as unknown as Parameters<typeof processResearchReport>[0],
      { id: input.candidate.id, pdfUrl: input.candidate.pdfUrl },
      { runId: input.runId, aiBudget: reportBudget, requestUsage: usage },
    )
    if (!isRetryableResearchReportFailure(result) || budget.snapshot().budgetExhausted || attempt === REPORT_PROCESSING_MAX_ATTEMPTS) break
    await retryDelay(attempt)
  }
  if (!result) throw new Error("Research report processing did not produce a result")

  const nextBudgetSnapshot = budget.snapshot()
  const outcome = classifyOutcome(result, nextBudgetSnapshot)
  const finishedAt = new Date().toISOString()

  await persistResearchReportRunItemStep({
    runId: input.runId,
    jobKey: input.jobKey,
    candidate: input.candidate,
    contentHash: result.contentHash,
    outcome,
    terminalStage: result.status === "ready" ? "PUBLISH" : usage.aiRequestCount > 0 || result.aiCalled ? "AI_ANALYZE" : "FETCH_PARSE",
    errorCode: outcome === "deferred_budget" ? nextBudgetSnapshot.budgetReason : result.status === "failed" ? "REPORT_PROCESSING_FAILED" : null,
    errorMessage: result.status === "failed" ? result.detail : null,
    usage,
    startedAt,
    finishedAt,
  })

  return { result, outcome, budgetSnapshot: nextBudgetSnapshot, usage }
}

export async function deferResearchReportRunStep(input: {
  runId: string
  jobKey: string
  candidate: ResearchReportWorkflowCandidate
  outcome: "deferred_budget" | "deferred_report_limit"
  budgetSnapshot: ResearchReportAiBudgetSnapshot
}): Promise<void> {
  "use step"
  const now = new Date().toISOString()
  await persistResearchReportRunItemStep({
    runId: input.runId, jobKey: input.jobKey, candidate: input.candidate, contentHash: null,
    outcome: input.outcome, terminalStage: "FINALIZE",
    errorCode: input.outcome === "deferred_budget" ? input.budgetSnapshot.budgetReason : "REPORT_LIMIT",
    errorMessage: null, usage: emptyUsage(), startedAt: now, finishedAt: now,
  })
}

export function initialResearchReportBudgetSnapshot(): ResearchReportAiBudgetSnapshot {
  return createResearchReportAiBudget({
    maxRequestAttempts: RESEARCH_REPORT_MAX_AI_REQUESTS,
    maxEstimatedCostUsd: RESEARCH_REPORT_MAX_AI_COST_USD,
  }).snapshot()
}