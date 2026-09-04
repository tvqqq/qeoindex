import "server-only"

import { markQeoIndexEodPhaseSkipped, runQeoIndexEodPhase } from "../admin/job-phase-telemetry.ts"
import type { EodTickerAttempt, EodTickerCoverage } from "./fault-isolation.ts"
import { getSupabaseServerClient } from "../../modules/shared/supabase/server.ts"

function requiredSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return supabase
}

export async function completeQeoIndexEodPartialStep(input: {
  runId: string
  runKey: string
  scanDate: string
  universeRunId: string
  coverage: EodTickerCoverage
  tickerAttempts: readonly EodTickerAttempt[]
  summary?: Record<string, unknown>
}) {
  "use step"

  const reason = `Canonical coverage incomplete: ${input.coverage.healthyCount}/${input.coverage.expectedCount}; failed=${input.coverage.failedTickers.join(",")}`
  for (const phaseKey of [
    "SUPABASE_VALIDATE",
    "SUPABASE_PUBLISH",
    "AI_COUNCIL_DETERMINISTIC",
    "MARKET_SYNTHESIS",
    "AI_COUNCIL_LLM",
    "NOTION_ARCHIVE",
    "RETENTION_CLEANUP",
  ] as const) {
    await markQeoIndexEodPhaseSkipped({
      runId: input.runId,
      phaseKey,
      reason: `${reason}; targeted retry must restore full canonical coverage first.`,
    })
  }

  return runQeoIndexEodPhase({
    runId: input.runId,
    phaseKey: "COMPLETE",
    fn: async () => {
      const finishedAt = new Date().toISOString()
      const summary = {
        ...input.summary,
        architecture: "supabase-first-eod-v4",
        terminalStatus: "partial",
        runKey: input.runKey,
        scanDate: input.scanDate,
        universeRunId: input.universeRunId,
        expectedCount: input.coverage.expectedCount,
        healthyCount: input.coverage.healthyCount,
        failedCount: input.coverage.failedCount,
        healthyTickers: input.coverage.healthyTickers,
        failedTickers: input.coverage.failedTickers,
        retryEligibleTickers: input.tickerAttempts
          .filter((attempt) => attempt.status === "failed" && attempt.retryEligible)
          .map((attempt) => attempt.ticker)
          .filter((ticker, index, rows) => rows.indexOf(ticker) === index)
          .sort(),
        tickerAttempts: input.tickerAttempts,
      }
      const result = await requiredSupabase().from("system_job_runs").update({
        status: "partial",
        finished_at: finishedAt,
        summary,
        error_code: "EOD_PARTIAL_TICKER_FAILURES",
        error_message: reason.slice(0, 1000),
      }).eq("id", input.runId)
      if (result.error) throw new Error(`QeoIndex EOD partial completion failed: ${result.error.message}`)
      return { ok: true as const, status: "partial" as const, finishedAt, coverage: input.coverage }
    },
    summarize: (result) => ({
      status: result.status,
      expectedCount: result.coverage.expectedCount,
      healthyCount: result.coverage.healthyCount,
      failedCount: result.coverage.failedCount,
      failedTickers: result.coverage.failedTickers,
    }),
  })
}
