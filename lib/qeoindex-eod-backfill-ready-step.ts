import { runQeoIndexEodPhase } from "@/lib/admin/job-phase-telemetry"
import { loadPersistentCouncilEodSnapshots } from "@/lib/ai-council-eod-market"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { beginWyckoffV2NotionRun } from "@/lib/wyckoff-v2-notion-staging"
import { loadWyckoffV2Universe } from "@/lib/wyckoff-v2-universe-source"

function requiredSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return supabase
}

function vietnamDateKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso))
}

export async function runEodBackfillReadyStep(runId: string, startedAtIso: string) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "EOD_READY",
    fn: async () => {
      const supabase = requiredSupabase()
      const expectedSessionDate = vietnamDateKey(startedAtIso)

      const ratings = await supabase
        .from("insights_stock_ratings")
        .select("ticker")
        .eq("is_published", true)
        .eq("source", "kfsp")
        .eq("is_top100", true)
        .eq("as_of_date", expectedSessionDate)
        .order("top100_rank", { ascending: true, nullsFirst: false })
        .order("ticker", { ascending: true })
      if (ratings.error) throw new Error(`Load historical EOD Top100 ratings failed: ${ratings.error.message}`)

      const tickers = [...new Set((ratings.data || []).map((row) => String(row.ticker || "").trim().toUpperCase()).filter(Boolean))]
      if (tickers.length !== 100) {
        throw Object.assign(new Error(`Historical Top100 rating universe incomplete for ${expectedSessionDate}: ${tickers.length}/100`), { code: "EOD_NOT_READY" })
      }

      const persistentMarket = await loadPersistentCouncilEodSnapshots(supabase, tickers, expectedSessionDate)
      if (persistentMarket.snapshots.length !== tickers.length) {
        throw Object.assign(
          new Error(`Historical market_ohlcv_history incomplete for ${expectedSessionDate}: ${persistentMarket.snapshots.length}/${tickers.length}; missing=${persistentMarket.missingTickers.join(",") || "none"}`),
          { code: "EOD_NOT_READY" },
        )
      }

      const selection = await loadWyckoffV2Universe()
      const scanDate = expectedSessionDate
      const runKey = `WYCKOFF-${scanDate}-EOD-v2`
      const notion = await beginWyckoffV2NotionRun({
        runKey,
        scanDate,
        startedAt: startedAtIso,
        providerSummary: "QeoIndex historical EOD v2 preflight; persistent OHLCV recovery source verified.",
      })

      return {
        runKey,
        scanDate,
        stocks: selection.stocks,
        rankWarnings: selection.warnings,
        notionAction: notion.action,
        notionStatus: notion.status,
        notionSupabaseRunId: "supabaseRunId" in notion ? notion.supabaseRunId : "",
        market: {
          expectedSessionDate,
          ratingDate: expectedSessionDate,
          ratingTickers: tickers,
          freshMarketCount: persistentMarket.snapshots.length,
          latestMarketUpdatedAt: persistentMarket.latestUpdatedAt,
          source: "persistent_ohlcv" as const,
        },
      }
    },
    summarize: (result) => ({
      runKey: result.runKey,
      scanDate: result.scanDate,
      universeCount: result.stocks.length,
      rankWarnings: result.rankWarnings.slice(0, 10),
      notionAction: result.notionAction,
      freshMarketCount: result.market.freshMarketCount,
      marketSource: result.market.source,
      historicalBackfill: true,
    }),
  })
}
