import { createResearchReportAiBudget, type ResearchReportAiBudgetSnapshot } from "../analysis/budget.ts"
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
export const DAILY_MAX_REPORTS = 20
export const DAILY_RECENT_RESCAN_DAYS = 30
export const RESEARCH_REPORT_MAX_AI_REQUESTS = 20
export const RESEARCH_REPORT_MAX_AI_COST_USD = 1

interface DbError { message?: string }
interface DbResult { data: unknown; error: DbError | null }
interface DbQuery extends PromiseLike<DbResult> {
  select(columns: string): DbQuery
  eq(column: string, value: unknown): DbQuery
  gte(column: string, value: unknown): DbQuery
  lte(column: string, value: unknown): DbQuery
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

function assertIsoDate(value: string, name: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be YYYY-MM-DD`)
  return value
}

function isoDateDaysBefore(isoTimestamp: string, days: number) {
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) throw new Error("Research Reports workflow start time is invalid")
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
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
    report.publishDate,
    report.title,
    report.sourceName,
    report.originalTypeReport,
    report.category,
    report.sectorName,
    report.recommendation,
    report.targetPrice,
    report.code,
    report.link,
    report.pdfUrl,
  ])
}

function rowFingerprint(row: ExistingReportRow) {
  return JSON.stringify([
    row.publish_date,
    row.title,
    row.source_name,
    row.original_type_report,
    row.category,
    row.sector_name,
    row.recommendation,
    row.target_price,
    row.code,
    row.link,
    row.pdf_url,
  ])
}

function emptyUsage(): ResearchReportAttemptUsage {
  return {
    attemptedModels: [],
    aiRequestCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    unknownUsageAttempts: 0,
    estimatedCostUsd: 0,
    pricingVersion: "",
  }
}

function classifyOutcome(result: ProcessResearchReportResult, budget: ResearchReportAiBudgetSnapshot): ResearchReportRunItemEvidence["outcome"] {
  if (result.status === "failed" && budget.budgetExhausted) return "deferred_budget"
  return result.status
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
  const maxReports = input.maxReports ?? DAILY_MAX_REPORTS
  if (!Number.isInteger(maxReports) || maxReports < 1 || maxReports > DAILY_MAX_REPORTS) {
    throw new Error(`Research Reports maxReports must be between 1 and ${DAILY_MAX_REPORTS}`)
  }

  const recentPublishDateFloor = mode === "backfill" && input.fromDate
    ? assertIsoDate(input.fromDate, "fromDate")
    : isoDateDaysBefore(input.startedAt, DAILY_RECENT_RESCAN_DAYS)
  const toDate = input.toDate ? assertIsoDate(input.toDate, "toDate") : null
  if (toDate && toDate < recentPublishDateFloor) throw new Error("Research Reports toDate must be on or after fromDate")

  await updateResearchReportsPhaseStep({ runId: input.runId, phase: "DISCOVER", status: "running" })

  const knownResult = await db.from("market_research_reports")
    .select("id,provider,external_report_id,publish_date,title,source_name,original_type_report,category,sector_name,recommendation,target_price,code,link,pdf_url,ingestion_status,analysis_status")
    .eq("provider", "topi")
    .order("publish_date", { ascending: false })
    .limit(500)
  safeDbError("Research Reports known metadata lookup failed", knownResult.error)
  const existingRows = rowsFrom(knownResult.data)
  const knownExternalReportIds = new Set(existingRows.map((row) => row.external_report_id))
  const beforeByExternalId = new Map(existingRows.map((row) => [row.external_report_id, row]))

  const discovery = await discoverTopiReports({
    knownExternalReportIds,
    recentPublishDateFloor,
    pageSize: DAILY_PAGE_SIZE,
    maxPages: DAILY_MAX_PAGES,
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
      toDate,
    },
  })

  await updateResearchReportsPhaseStep({ runId: input.runId, phase: "UPSERT_METADATA", status: "running" })
  await upsertResearchReports(
    db as unknown as Parameters<typeof upsertResearchReports>[0],
    scopedReports,
  )

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
      .limit(120)
    safeDbError("Research Reports persisted metadata lookup failed", persistedResult.error)
    persistedRows = rowsFrom(persistedResult.data)
  }

  const persistedByExternalId = new Map(persistedRows.map((row) => [row.external_report_id, row]))
  const allCandidates = scopedReports.flatMap<ResearchReportWorkflowCandidate>((report) => {
    const persisted = persistedByExternalId.get(report.externalReportId)
    if (!persisted) return []
    return [{
      id: persisted.id,
      provider: "topi",
      externalReportId: persisted.external_report_id,
      publishDate: persisted.publish_date,
      pdfUrl: persisted.pdf_url,
    }]
  })
  const candidates = allCandidates.slice(0, maxReports)
  const deferredReportLimit = Math.max(0, allCandidates.length - candidates.length)

  await updateResearchReportsPhaseStep({
    runId: input.runId,
    phase: "UPSERT_METADATA",
    status: "succeeded",
    summary: {
      upserted: scopedReports.length,
      newCount,
      changedCount,
      unchangedCount,
      candidates: candidates.length,
      deferredReportLimit,
    },
  })

  return {
    candidates,
    discovered: scopedReports.length,
    newCount,
    changedCount,
    unchangedCount,
    deferredReportLimit,
    pagesFetched: discovery.pagesFetched,
    boundaryReason: discovery.boundaryReason,
    hitDiscoverySafetyLimit: discovery.reachedSafetyLimit,
    recentPublishDateFloor,
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
  const usage = emptyUsage()

  const result = await processResearchReport(
    db as unknown as Parameters<typeof processResearchReport>[0],
    { id: input.candidate.id, pdfUrl: input.candidate.pdfUrl },
    { runId: input.runId, aiBudget: budget, requestUsage: usage },
  )
  const nextBudgetSnapshot = budget.snapshot()
  const outcome = classifyOutcome(result, nextBudgetSnapshot)
  const finishedAt = new Date().toISOString()

  await persistResearchReportRunItemStep({
    runId: input.runId,
    jobKey: input.jobKey,
    candidate: input.candidate,
    contentHash: result.contentHash,
    outcome,
    terminalStage: result.status === "ready" ? "PUBLISH" : result.aiCalled ? "AI_ANALYZE" : "FETCH_PARSE",
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
    runId: input.runId,
    jobKey: input.jobKey,
    candidate: input.candidate,
    contentHash: null,
    outcome: input.outcome,
    terminalStage: "FINALIZE",
    errorCode: input.outcome === "deferred_budget" ? input.budgetSnapshot.budgetReason : "REPORT_LIMIT",
    errorMessage: null,
    usage: emptyUsage(),
    startedAt: now,
    finishedAt: now,
  })
}

export function initialResearchReportBudgetSnapshot(): ResearchReportAiBudgetSnapshot {
  return createResearchReportAiBudget({
    maxRequestAttempts: RESEARCH_REPORT_MAX_AI_REQUESTS,
    maxEstimatedCostUsd: RESEARCH_REPORT_MAX_AI_COST_USD,
  }).snapshot()
}
