import { runQeoIndexEodPhase } from "@/modules/admin/job-phase-telemetry"
import { loadPersistentCouncilEodSnapshots } from "@/modules/ai-council/eod-market"
import { getCanonicalUniverse } from "@/modules/market/universe/index"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import { loadWyckoffV2Universe } from "@/modules/wyckoff/eod-universe-source"
import { vietnamDateKey } from "@/modules/market/calendar"

function requiredSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return supabase
}


export async function runEodBackfillReadyStep(runId: string, startedAtIso: string) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "EOD_READY",
    fn: async () => {
      const supabase = requiredSupabase()
      const expectedSessionDate = vietnamDateKey(startedAtIso)
      const universe = await getCanonicalUniverse()
      const tickers = universe.stocks.map((stock) => stock.ticker)
      if (!tickers.length) {
        throw Object.assign(new Error("Canonical market universe is empty"), { code: "EOD_NOT_READY" })
      }

      const ratings = await supabase
        .from("insights_stock_ratings")
        .select("ticker")
        .eq("is_published", true)
        .eq("source", "kfsp")
        .eq("as_of_date", expectedSessionDate)
        .in("ticker", tickers)
      if (ratings.error) throw new Error(`Load historical canonical ratings failed: ${ratings.error.message}`)

      const ratingTickers = new Set(
        (ratings.data || [])
          .map((row) => String(row.ticker || "").trim().toUpperCase())
          .filter(Boolean),
      )
      const missingRatings = tickers.filter((ticker) => !ratingTickers.has(ticker))
      if (missingRatings.length) {
        throw Object.assign(
          new Error(
            `Historical canonical rating universe incomplete for ${expectedSessionDate}: `
            + `${tickers.length - missingRatings.length}/${tickers.length}; `
            + `missing=${missingRatings.slice(0, 20).join(",")}`,
          ),
          { code: "EOD_NOT_READY" },
        )
      }

      const persistentMarket = await loadPersistentCouncilEodSnapshots(
        supabase,
        tickers,
        expectedSessionDate,
      )
      if (persistentMarket.snapshots.length !== tickers.length) {
        throw Object.assign(
          new Error(
            `Historical market_ohlcv_history incomplete for ${expectedSessionDate}: `
            + `${persistentMarket.snapshots.length}/${tickers.length}; `
            + `missing=${persistentMarket.missingTickers.join(",") || "none"}`,
          ),
          { code: "EOD_NOT_READY" },
        )
      }

      const selection = await loadWyckoffV2Universe()
      if (selection.stocks.length !== tickers.length) {
        throw Object.assign(
          new Error(`Historical canonical Wyckoff selection mismatch: ${selection.stocks.length}/${tickers.length}`),
          { code: "EOD_NOT_READY" },
        )
      }
      const scanDate = expectedSessionDate
      const runKey = `WYCKOFF-${scanDate}-EOD-v4`

      return {
        runKey,
        scanDate,
        stocks: selection.stocks,
        rankWarnings: selection.warnings,
        market: {
          expectedSessionDate,
          ratingDate: expectedSessionDate,
          ratingTickers: tickers,
          freshMarketCount: persistentMarket.snapshots.length,
          latestMarketUpdatedAt: persistentMarket.latestUpdatedAt,
          source: "persistent_ohlcv" as const,
          universeRunId: universe.runId,
        },
      }
    },
    summarize: (result) => ({
      runKey: result.runKey,
      scanDate: result.scanDate,
      universeCount: result.stocks.length,
      rankWarnings: result.rankWarnings.slice(0, 10),
      freshMarketCount: result.market.freshMarketCount,
      marketSource: result.market.source,
      historicalBackfill: true,
      universeRunId: result.market.universeRunId,
      architecture: "supabase-first-eod-v4-dag",
    }),
  })
}
