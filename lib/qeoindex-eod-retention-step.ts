import "server-only"

import { runQeoIndexEodPhase } from "@/lib/admin/job-phase-telemetry"
import {
  archiveEodRunToNotion,
  runEodRetentionCleanup,
  type EodArchiveCheckpoint,
} from "@/lib/qeoindex-eod-archive"
import { getCanonicalUniverse } from "@/lib/market-universe"
import { getSupabaseServerClient } from "@/lib/supabase/server"

function requiredSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return supabase
}

// Compatibility-only value for the historical Notion run schema. It is static
// metadata, never a Drive request and never participates in completion gating.
const REMOVED_DRIVE_ARCHIVE: EodArchiveCheckpoint = {
  status: "skipped",
  archived: 0,
  detail: "Google Drive is not part of active EOD v4; raw Supabase Daily history remains retained.",
  manifestUrl: null,
}

export async function runRetentionCleanupStep(
  runId: string,
  input: {
    startedAtIso: string
    tradingDate: string
    universeRunId: string
    universeCount: number
    expectedSnapshots: number
    completedSnapshots: number
    validationHash: string
    marketSynthesisStatus: string
    notionArchive: EodArchiveCheckpoint
  },
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "RETENTION_CLEANUP",
    fn: async () => {
      const retention = await runEodRetentionCleanup(requiredSupabase(), {
        tradingDate: input.tradingDate,
        notionArchive: input.notionArchive,
      })

      const supabase = requiredSupabase()
      const canonical = await getCanonicalUniverse()
      const tickers = canonical.stocks.map((stock) => stock.ticker)
      const deterministic = await supabase
        .from("ai_council_runs")
        .select("id", { count: "exact", head: true })
        .eq("as_of_date", input.tradingDate)
        .in("ticker", tickers)
      const llm = await supabase
        .from("ai_council_llm_debates")
        .select("status")
        .eq("as_of_date", input.tradingDate)
        .in("ticker", tickers)

      const llmRows = llm.error ? [] : (llm.data || [])
      const llmCompleted = llmRows.filter((row) => ["completed", "succeeded"].includes(String(row.status))).length
      const completedAt = new Date().toISOString()
      const partial = input.notionArchive.status !== "archived"
        || retention.status !== "archived"
        || input.marketSynthesisStatus === "failed"
        || Boolean(deterministic.error)
        || Boolean(llm.error)

      let runArchive: { status: string; detail?: string } = { status: "skipped" }
      try {
        runArchive = await archiveEodRunToNotion({
          tradingDate: input.tradingDate,
          eodRunId: runId,
          status: partial ? "Partial" : "Succeeded",
          universeRunId: input.universeRunId,
          universeCount: input.universeCount,
          expectedSnapshots: input.expectedSnapshots,
          completedSnapshots: input.completedSnapshots,
          deterministicExpected: input.universeCount,
          deterministicCompleted: deterministic.error ? 0 : Number(deterministic.count || 0),
          llmCandidates: llmRows.length,
          llmCompleted,
          validationHash: input.validationHash,
          startedAt: input.startedAtIso,
          completedAt,
          notionArchive: input.notionArchive,
          driveArchive: REMOVED_DRIVE_ARCHIVE,
          retention,
          errorCode: partial ? "ARCHIVE_OR_SYNTHESIS_PARTIAL" : "",
          errorSummary: [
            input.notionArchive.detail,
            retention.detail,
            deterministic.error?.message,
            llm.error?.message,
          ].filter(Boolean).join(" | ").slice(0, 1800),
        })
      } catch (error) {
        runArchive = {
          status: "error",
          detail: error instanceof Error ? error.message : String(error),
        }
      }

      return {
        ...retention,
        notionRunArchive: runArchive.status,
        notionRunArchiveDetail: runArchive.detail,
        deterministicCompleted: deterministic.error ? 0 : Number(deterministic.count || 0),
        llmCandidates: llmRows.length,
        llmCompleted,
      }
    },
    summarize: (result) => result,
  })
}
