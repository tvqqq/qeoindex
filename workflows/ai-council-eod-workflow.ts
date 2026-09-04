import {
  assertFinalEodMarketReadyStep,
  finishAiCouncilEodTelemetryStep,
  runDeterministicCouncilStep,
  runLlmDebateStep,
  runWyckoffBatchStep,
  startAiCouncilEodTelemetryStep,
  validateWyckoffTop100Step,
} from "@/modules/ai-council/eod-workflow-steps"

const WYCKOFF_EOD_BATCH_OFFSETS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90] as const

export async function aiCouncilEodWorkflow(startedAtIso: string) {
  "use workflow"

  const telemetryRunId = await startAiCouncilEodTelemetryStep(startedAtIso)

  try {
    const market = await assertFinalEodMarketReadyStep(startedAtIso)
    if (!market.ok) {
      const result = { ok: false, status: "skipped", stage: "market", market, completedAt: new Date().toISOString() }
      await finishAiCouncilEodTelemetryStep(telemetryRunId, startedAtIso, "skipped", {
        pipelineStatus: result.status,
        stage: result.stage,
        expectedSessionDate: market.expectedSessionDate,
        ratingDate: market.ratingDate,
        freshMarketCount: market.freshMarketCount,
        issueCount: market.issues.length,
      })
      return result
    }

    const batchResults = []
    for (const offset of WYCKOFF_EOD_BATCH_OFFSETS) {
      batchResults.push(await runWyckoffBatchStep(offset))
    }

    const wyckoffValidation = await validateWyckoffTop100Step(market.expectedSessionDate, market.tickers)
    if (!wyckoffValidation.ok) {
      const result = {
        ok: false,
        status: "skipped",
        stage: "wyckoff",
        market,
        wyckoffValidation,
        batchErrors: batchResults.flatMap((batch) => batch.errors),
        completedAt: new Date().toISOString(),
      }
      await finishAiCouncilEodTelemetryStep(telemetryRunId, startedAtIso, "skipped", {
        pipelineStatus: result.status,
        stage: result.stage,
        expectedSessionDate: market.expectedSessionDate,
        freshMarketCount: market.freshMarketCount,
        wyckoffFreshCount: wyckoffValidation.freshCount,
        wyckoffExpectedCount: wyckoffValidation.expectedCount,
        batchErrorCount: result.batchErrors.length,
      })
      return result
    }

    const deterministic = await runDeterministicCouncilStep()
    if (!deterministic.ok) {
      const result = {
        ok: false,
        status: "skipped",
        stage: "deterministic",
        market,
        wyckoffValidation,
        deterministic,
        completedAt: new Date().toISOString(),
      }
      await finishAiCouncilEodTelemetryStep(telemetryRunId, startedAtIso, "skipped", {
        pipelineStatus: result.status,
        stage: result.stage,
        expectedSessionDate: market.expectedSessionDate,
        freshMarketCount: market.freshMarketCount,
        wyckoffFreshCount: wyckoffValidation.freshCount,
        deterministicReason: deterministic.reason,
      })
      return result
    }

    const debate = await runLlmDebateStep()
    const result = {
      ok: debate.ok,
      status: debate.ok ? "completed" : "partial",
      stage: debate.ok ? "completed" : "llm",
      market,
      wyckoffValidation,
      deterministic,
      debate,
      completedAt: new Date().toISOString(),
    }

    await finishAiCouncilEodTelemetryStep(
      telemetryRunId,
      startedAtIso,
      debate.ok ? "succeeded" : "skipped",
      {
        pipelineStatus: result.status,
        stage: result.stage,
        expectedSessionDate: market.expectedSessionDate,
        freshMarketCount: market.freshMarketCount,
        wyckoffFreshCount: wyckoffValidation.freshCount,
        deterministicOk: deterministic.ok,
        debateOk: debate.ok,
        debateStatus: debate.status,
        selectedTickers: "selected" in debate ? debate.selected : null,
      },
    )

    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await finishAiCouncilEodTelemetryStep(
      telemetryRunId,
      startedAtIso,
      "failed",
      { pipelineStatus: "failed", stage: "exception" },
      message,
    )
    throw error
  }
}
