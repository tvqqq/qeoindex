import {
  generateResearchReportSummaryImageBackfillStep,
  normalizeResearchReportSummaryImageBackfillMaxReports,
  prepareResearchReportSummaryImageBackfillStep,
} from "@/modules/research-reports/summary-image-backfill"
import { initialResearchReportBudgetSnapshot } from "@/modules/research-reports/daily/runtime"
import {
  failResearchReportsRunStep,
  finishResearchReportsRunStep,
  persistResearchReportRunItemStep,
  startResearchReportsRunStep,
  updateResearchReportsPhaseStep,
  type ResearchReportAttemptUsage,
} from "@/modules/research-reports/daily/telemetry"

const JOB_KEY = "research_reports.image_backfill"
const PROVIDER = "machine"

export interface ResearchReportSummaryImageBackfillWorkflowInput {
  startedAt: string
  maxReports?: number
  reason?: string
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

export async function researchReportSummaryImageBackfillWorkflow(
  input: ResearchReportSummaryImageBackfillWorkflowInput,
) {
  "use workflow"

  const maxReports = normalizeResearchReportSummaryImageBackfillMaxReports(input.maxReports)
  const runId = await startResearchReportsRunStep({
    jobKey: JOB_KEY,
    provider: PROVIDER,
    trigger: "workflow",
    startedAt: input.startedAt,
  })

  try {
    await updateResearchReportsPhaseStep({
      runId,
      phase: "DISCOVER",
      status: "running",
      summary: { maxReports, mode: "summary_image_backfill" },
    })

    const prepared = await prepareResearchReportSummaryImageBackfillStep({ maxReports })

    await updateResearchReportsPhaseStep({
      runId,
      phase: "DISCOVER",
      status: "succeeded",
      summary: {
        scanned: prepared.scanned,
        selected: prepared.selected.length,
        skippedReadyCurrent: prepared.skippedReadyCurrent,
        skippedGenerating: prepared.skippedGenerating,
        missingCurrentAnalysis: prepared.missingCurrentAnalysis,
        hasMore: prepared.hasMore,
      },
    })

    for (const phase of ["UPSERT_METADATA", "FETCH_PARSE", "AI_ANALYZE"] as const) {
      await updateResearchReportsPhaseStep({
        runId,
        phase,
        status: "skipped",
        summary: {
          reason: "Image-only backfill reuses persisted current analysis; no provider discovery, PDF fetch, parse, or report-analysis AI.",
        },
      })
    }

    await updateResearchReportsPhaseStep({
      runId,
      phase: "PUBLISH",
      status: "running",
      summary: { selected: prepared.selected.length },
    })

    let generated = 0
    let skippedExisting = 0
    let failed = 0

    for (const candidate of prepared.selected) {
      const result = await generateResearchReportSummaryImageBackfillStep(candidate)
      if (result.status === "ready") generated += 1
      else if (result.status === "skipped_existing") skippedExisting += 1
      else failed += 1

      await persistResearchReportRunItemStep({
        runId,
        jobKey: JOB_KEY,
        candidate,
        contentHash: candidate.contentHash,
        outcome: result.status,
        terminalStage: "PUBLISH",
        errorCode: result.status === "failed" ? "SUMMARY_IMAGE_GENERATION_FAILED" : null,
        errorMessage: result.status === "failed" ? result.detail : null,
        usage: emptyUsage(),
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
      })
    }

    const publishSummary = {
      selected: prepared.selected.length,
      generated,
      skippedExisting,
      failed,
      hasMore: prepared.hasMore,
    }

    await updateResearchReportsPhaseStep({
      runId,
      phase: "PUBLISH",
      status: "succeeded",
      summary: publishSummary,
    })

    const status = failed > 0 || prepared.hasMore ? "partial" as const : "succeeded" as const
    const summary = {
      runDate: input.startedAt.slice(0, 10),
      mode: "summary_image_backfill",
      maxReports,
      reason: input.reason?.slice(0, 240) ?? null,
      scanned: prepared.scanned,
      selected: prepared.selected.length,
      generated,
      skippedExisting,
      failed,
      skippedReadyCurrent: prepared.skippedReadyCurrent,
      skippedGenerating: prepared.skippedGenerating,
      missingCurrentAnalysis: prepared.missingCurrentAnalysis,
      hasMore: prepared.hasMore,
      reportAnalysisAiRequests: 0,
    }

    await updateResearchReportsPhaseStep({ runId, phase: "FINALIZE", status: "running", summary })
    await updateResearchReportsPhaseStep({
      runId,
      phase: "FINALIZE",
      status: "succeeded",
      summary: { ...summary, status },
    })
    await finishResearchReportsRunStep({
      runId,
      startedAt: input.startedAt,
      status,
      summary,
      budgetSnapshot: initialResearchReportBudgetSnapshot(),
    })

    return { runId, status, summary }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await updateResearchReportsPhaseStep({
        runId,
        phase: "FINALIZE",
        status: "failed",
        errorCode: "RESEARCH_REPORT_SUMMARY_IMAGE_BACKFILL_FAILED",
        errorMessage: message,
      })
    } catch {
      // Parent run telemetry below remains the canonical terminal evidence.
    }

    await failResearchReportsRunStep({
      runId,
      startedAt: input.startedAt,
      errorMessage: message,
      errorCode: "RESEARCH_REPORT_SUMMARY_IMAGE_BACKFILL_FAILED",
    })
    throw error
  }
}
