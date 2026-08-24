import {
  assertFinalEodMarketReadyStep,
  runDeterministicCouncilStep,
  runLlmDebateStep,
  runWyckoffBatchStep,
  validateWyckoffTop100Step,
} from "@/lib/ai-council-eod-workflow-steps"

const WYCKOFF_EOD_BATCH_OFFSETS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90] as const

export async function aiCouncilEodWorkflow(startedAtIso: string) {
  "use workflow"

  const market = await assertFinalEodMarketReadyStep(startedAtIso)
  if (!market.ok) {
    return { ok: false, status: "skipped", stage: "market", market, completedAt: new Date().toISOString() }
  }

  const batchResults = []
  for (const offset of WYCKOFF_EOD_BATCH_OFFSETS) {
    batchResults.push(await runWyckoffBatchStep(offset))
  }

  const wyckoffValidation = await validateWyckoffTop100Step(market.expectedSessionDate, market.tickers)
  if (!wyckoffValidation.ok) {
    return {
      ok: false,
      status: "skipped",
      stage: "wyckoff",
      market,
      wyckoffValidation,
      batchErrors: batchResults.flatMap((batch) => batch.errors),
      completedAt: new Date().toISOString(),
    }
  }

  const deterministic = await runDeterministicCouncilStep()
  if (!deterministic.ok) {
    return {
      ok: false,
      status: "skipped",
      stage: "deterministic",
      market,
      wyckoffValidation,
      deterministic,
      completedAt: new Date().toISOString(),
    }
  }

  const debate = await runLlmDebateStep()
  return {
    ok: debate.ok,
    status: debate.ok ? "completed" : "partial",
    stage: debate.ok ? "completed" : "llm",
    market,
    wyckoffValidation,
    deterministic,
    debate,
    completedAt: new Date().toISOString(),
  }
}
