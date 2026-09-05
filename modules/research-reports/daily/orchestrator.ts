import type {
  ProcessResearchReportResult,
  ResearchReportDiscoveryResult,
  ResearchReportSourceRecord,
} from "../types.ts"

export type ResearchReportsWorkflowMode = "daily" | "backfill"
export type ResearchReportsRunStatus = "succeeded" | "partial"

export interface ResearchReportWorkflowCandidate {
  id: string
  provider: "topi"
  externalReportId: string
  publishDate: string
  pdfUrl: string
}

export interface ResearchReportMetadataResolution {
  discovered: number
  newCount: number
  changedCount: number
  unchangedCount: number
  candidates: ResearchReportWorkflowCandidate[]
}

export interface ResearchReportsOrchestratorDependencies {
  discover(input: {
    mode: ResearchReportsWorkflowMode
    fromDate?: string
    toDate?: string
  }): Promise<ResearchReportDiscoveryResult>
  upsertAndResolve(
    reports: readonly ResearchReportSourceRecord[],
    input: { mode: ResearchReportsWorkflowMode; fromDate?: string; toDate?: string },
  ): Promise<ResearchReportMetadataResolution>
  processReport(report: ResearchReportWorkflowCandidate): Promise<ProcessResearchReportResult>
}

export interface RunResearchReportsOrchestratorInput {
  mode: ResearchReportsWorkflowMode
  fromDate?: string
  toDate?: string
  maxReports?: number
}

export interface ResearchReportsOrchestratorResult {
  status: ResearchReportsRunStatus
  pagesFetched: number
  boundaryReason: ResearchReportDiscoveryResult["boundaryReason"]
  hitDiscoverySafetyLimit: boolean
  discovered: number
  newCount: number
  changedCount: number
  unchangedCount: number
  processed: number
  ready: number
  skippedExisting: number
  skippedConcurrent: number
  needsOcr: number
  unsupported: number
  failed: number
  deferred: number
  aiCalledReports: number
}

const DEFAULT_MAX_REPORTS = 20
const HARD_MAX_REPORTS = 100

function validateMaxReports(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > HARD_MAX_REPORTS) {
    throw new Error(`Research report maxReports must be between 1 and ${HARD_MAX_REPORTS}`)
  }
  return value
}

export async function runResearchReportsOrchestrator(
  input: RunResearchReportsOrchestratorInput,
  deps: ResearchReportsOrchestratorDependencies,
): Promise<ResearchReportsOrchestratorResult> {
  const maxReports = validateMaxReports(input.maxReports ?? DEFAULT_MAX_REPORTS)
  const scope = { mode: input.mode, fromDate: input.fromDate, toDate: input.toDate }
  const discovery = await deps.discover(scope)
  const resolved = await deps.upsertAndResolve(discovery.reports, scope)

  const selected = resolved.candidates.slice(0, maxReports)
  const deferred = Math.max(0, resolved.candidates.length - selected.length)

  let ready = 0
  let skippedExisting = 0
  let skippedConcurrent = 0
  let needsOcr = 0
  let unsupported = 0
  let failed = 0
  let aiCalledReports = 0

  for (const report of selected) {
    const result = await deps.processReport(report)
    if (result.aiCalled) aiCalledReports += 1

    switch (result.status) {
      case "ready":
        ready += 1
        break
      case "skipped_existing":
        skippedExisting += 1
        break
      case "skipped_concurrent":
        skippedConcurrent += 1
        break
      case "needs_ocr":
        needsOcr += 1
        break
      case "unsupported":
        unsupported += 1
        break
      case "failed":
        failed += 1
        break
    }
  }

  const status: ResearchReportsRunStatus = failed > 0 || deferred > 0 || discovery.reachedSafetyLimit
    ? "partial"
    : "succeeded"

  return {
    status,
    pagesFetched: discovery.pagesFetched,
    boundaryReason: discovery.boundaryReason,
    hitDiscoverySafetyLimit: discovery.reachedSafetyLimit,
    discovered: resolved.discovered,
    newCount: resolved.newCount,
    changedCount: resolved.changedCount,
    unchangedCount: resolved.unchangedCount,
    processed: selected.length,
    ready,
    skippedExisting,
    skippedConcurrent,
    needsOcr,
    unsupported,
    failed,
    deferred,
    aiCalledReports,
  }
}
