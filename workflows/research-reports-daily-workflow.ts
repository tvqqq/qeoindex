import {
  deferResearchReportRunStep,
  initialResearchReportBudgetSnapshot,
  prepareResearchReportsRunStep,
  processResearchReportRunStep,
} from "@/modules/research-reports/daily/runtime"
import {
  failResearchReportsRunStep,
  finishResearchReportsRunStep,
  RESEARCH_REPORTS_DAILY_JOB_KEY,
  RESEARCH_REPORTS_DAILY_PROVIDER,
  startResearchReportsRunStep,
  updateResearchReportsPhaseStep,
  type ResearchReportAttemptUsage,
} from "@/modules/research-reports/daily/telemetry"

interface WorkflowCounts {
  processed: number
  ready: number
  skippedExisting: number
  skippedConcurrent: number
  needsOcr: number
  unsupported: number
  failed: number
  deferredBudget: number
}

function emptyCounts(): WorkflowCounts {
  return {
    processed: 0,
    ready: 0,
    skippedExisting: 0,
    skippedConcurrent: 0,
    needsOcr: 0,
    unsupported: 0,
    failed: 0,
    deferredBudget: 0,
  }
}

function emptyUsage(): ResearchReportAttemptUsage {
  return {
    attemptedModels: [], aiRequestCount: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0,
    outputTokens: 0, reasoningTokens: 0, totalTokens: 0, unknownUsageAttempts: 0,
    estimatedCostUsd: 0, pricingVersion: "",
  }
}

function addUsage(target: ResearchReportAttemptUsage, usage: ResearchReportAttemptUsage) {
  for (const model of usage.attemptedModels) if (!target.attemptedModels.includes(model)) target.attemptedModels.push(model)
  target.aiRequestCount += usage.aiRequestCount
  target.inputTokens += usage.inputTokens
  target.cachedInputTokens += usage.cachedInputTokens
  target.cacheWriteTokens += usage.cacheWriteTokens
  target.outputTokens += usage.outputTokens
  target.reasoningTokens += usage.reasoningTokens
  target.totalTokens += usage.totalTokens
  target.unknownUsageAttempts += usage.unknownUsageAttempts
  target.estimatedCostUsd = Number((target.estimatedCostUsd + usage.estimatedCostUsd).toFixed(12))
  if (usage.pricingVersion) target.pricingVersion = usage.pricingVersion
}

function addOutcome(counts: WorkflowCounts, outcome: string) {
  counts.processed += 1
  if (outcome === "ready") counts.ready += 1
  else if (outcome === "skipped_existing") counts.skippedExisting += 1
  else if (outcome === "skipped_concurrent") counts.skippedConcurrent += 1
  else if (outcome === "needs_ocr") counts.needsOcr += 1
  else if (outcome === "unsupported") counts.unsupported += 1
  else if (outcome === "deferred_budget") counts.deferredBudget += 1
  else if (outcome === "failed") counts.failed += 1
}

export async function researchReportsDailyWorkflow(startedAtIso: string) {
  "use workflow"

  const runId = await startResearchReportsRunStep({
    jobKey: RESEARCH_REPORTS_DAILY_JOB_KEY,
    provider: RESEARCH_REPORTS_DAILY_PROVIDER,
    trigger: "workflow",
    startedAt: startedAtIso,
  })

  try {
    const prepared = await prepareResearchReportsRunStep({
      runId,
      startedAt: startedAtIso,
      mode: "daily",
    })

    await updateResearchReportsPhaseStep({ runId, phase: "FETCH_PARSE", status: "running" })
    await updateResearchReportsPhaseStep({ runId, phase: "AI_ANALYZE", status: "running" })
    await updateResearchReportsPhaseStep({ runId, phase: "PUBLISH", status: "running" })

    let budgetSnapshot = initialResearchReportBudgetSnapshot()
    const counts = emptyCounts()
    const usage = emptyUsage()

    for (const candidate of prepared.candidates) {
      if (budgetSnapshot.budgetExhausted) {
        await deferResearchReportRunStep({
          runId,
          jobKey: RESEARCH_REPORTS_DAILY_JOB_KEY,
          candidate,
          outcome: "deferred_budget",
          budgetSnapshot,
        })
        counts.processed += 1
        counts.deferredBudget += 1
        continue
      }

      const processed = await processResearchReportRunStep({
        runId,
        jobKey: RESEARCH_REPORTS_DAILY_JOB_KEY,
        candidate,
        budgetSnapshot,
      })
      budgetSnapshot = processed.budgetSnapshot
      addUsage(usage, processed.usage)
      addOutcome(counts, processed.outcome)
    }

    const phaseSummary = {
      processed: counts.processed,
      ready: counts.ready,
      skippedExisting: counts.skippedExisting,
      skippedConcurrent: counts.skippedConcurrent,
      needsOcr: counts.needsOcr,
      unsupported: counts.unsupported,
      failed: counts.failed,
      deferredBudget: counts.deferredBudget,
    }
    await updateResearchReportsPhaseStep({ runId, phase: "FETCH_PARSE", status: "succeeded", summary: phaseSummary })
    await updateResearchReportsPhaseStep({ runId, phase: "AI_ANALYZE", status: "succeeded", summary: {
      models: usage.attemptedModels,
      aiRequestCount: usage.aiRequestCount,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      totalTokens: usage.totalTokens,
      estimatedCostUsd: usage.estimatedCostUsd,
      unknownUsageAttempts: usage.unknownUsageAttempts,
      budgetExhausted: budgetSnapshot.budgetExhausted,
      budgetReason: budgetSnapshot.budgetReason,
    } })
    await updateResearchReportsPhaseStep({ runId, phase: "PUBLISH", status: "succeeded", summary: {
      ready: counts.ready,
      failed: counts.failed,
      skippedExisting: counts.skippedExisting,
      skippedConcurrent: counts.skippedConcurrent,
    } })

    const deferred = prepared.deferredReportLimit + counts.deferredBudget
    const status = counts.failed > 0 || deferred > 0 || prepared.hitDiscoverySafetyLimit
      ? "partial" as const
      : "succeeded" as const
    const summary = {
      runDate: startedAtIso.slice(0, 10),
      pagesFetched: prepared.pagesFetched,
      boundaryReason: prepared.boundaryReason,
      hitDiscoverySafetyLimit: prepared.hitDiscoverySafetyLimit,
      discovered: prepared.discovered,
      newCount: prepared.newCount,
      changedCount: prepared.changedCount,
      unchangedCount: prepared.unchangedCount,
      processed: counts.processed,
      ready: counts.ready,
      skippedExisting: counts.skippedExisting,
      skippedConcurrent: counts.skippedConcurrent,
      needsOcr: counts.needsOcr,
      unsupported: counts.unsupported,
      failed: counts.failed,
      deferred,
      deferredReportLimit: prepared.deferredReportLimit,
      deferredBudget: counts.deferredBudget,
      aiModels: usage.attemptedModels,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      outputTokens: usage.outputTokens,
      reasoningTokens: usage.reasoningTokens,
      totalTokens: usage.totalTokens,
      unknownUsageAttempts: usage.unknownUsageAttempts,
    }

    await updateResearchReportsPhaseStep({ runId, phase: "FINALIZE", status: "running", summary })
    await updateResearchReportsPhaseStep({ runId, phase: "FINALIZE", status: "succeeded", summary: { ...summary, status } })
    await finishResearchReportsRunStep({
      runId,
      startedAt: startedAtIso,
      status,
      summary,
      budgetSnapshot,
    })

    return { runId, status, summary, budgetSnapshot }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await updateResearchReportsPhaseStep({
        runId,
        phase: "FINALIZE",
        status: "failed",
        errorCode: "RESEARCH_REPORTS_DAILY_FAILED",
        errorMessage: message,
      })
    } catch {
      // Parent failure telemetry below remains the required terminal evidence.
    }
    await failResearchReportsRunStep({ runId, startedAt: startedAtIso, errorMessage: message })
    throw error
  }
}
