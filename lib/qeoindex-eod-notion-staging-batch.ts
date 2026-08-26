import { markQeoIndexEodPhaseSkipped, runQeoIndexEodPhase } from "@/lib/admin/job-phase-telemetry"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { buildWyckoffV2TickerSnapshots } from "@/lib/wyckoff-v2-builder"
import { loadWyckoffV2CachedTickerHistory } from "@/lib/wyckoff-v2-cache-read"
import { stageWyckoffV2SnapshotBatch } from "@/lib/wyckoff-v2-notion-batch"
import type { WyckoffV2UniverseRow } from "@/lib/wyckoff-v2-universe"

export interface NotionStagingProgress {
  created: number
  updated: number
  skippedRows: number
  total: number
  providers: string[]
}

function requiredSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return supabase
}

async function buildSnapshotBatch(stocks: WyckoffV2UniverseRow[], runKey: string, scanDate: string) {
  const supabase = requiredSupabase()
  const providers = new Set<string>()
  const nested = await Promise.all(stocks.map(async (stock) => {
    const history = await loadWyckoffV2CachedTickerHistory(supabase, stock.ticker)
    providers.add(history.daily.provider)
    providers.add(history.hourly.provider)
    return buildWyckoffV2TickerSnapshots({
      stock,
      daily: history.daily,
      hourly: history.hourly,
      runKey,
      scanDate,
    })
  }))
  const snapshots = nested.flat()
  const expected = stocks.length * 5
  if (snapshots.length !== expected) {
    throw Object.assign(
      new Error(`NOTION_STAGING batch built ${snapshots.length}/${expected} snapshots`),
      { code: "NOTION_STAGING_FAILED" },
    )
  }
  return { snapshots, providers: [...providers].sort() }
}

function mergeNotionStagingProgress(
  previous: NotionStagingProgress,
  current: NotionStagingProgress,
): NotionStagingProgress {
  return {
    created: previous.created + current.created,
    updated: previous.updated + current.updated,
    skippedRows: previous.skippedRows + current.skippedRows,
    total: previous.total + current.total,
    providers: [...new Set([...previous.providers, ...current.providers])].sort(),
  }
}

export async function runNotionStagingBatchStep(
  runId: string,
  stocks: WyckoffV2UniverseRow[],
  runKey: string,
  scanDate: string,
  progress: NotionStagingProgress,
  enabled = true,
) {
  "use step"
  if (!enabled) {
    await markQeoIndexEodPhaseSkipped({
      runId,
      phaseKey: "NOTION_STAGING",
      reason: "Existing Ready/Ingested Notion run; staging skipped.",
    })
    return progress
  }

  return runQeoIndexEodPhase({
    runId,
    phaseKey: "NOTION_STAGING",
    fn: async () => {
      if (stocks.length < 1 || stocks.length > 10) {
        throw Object.assign(
          new Error(`NOTION_STAGING batch must contain 1-10 tickers; received ${stocks.length}`),
          { code: "NOTION_STAGING_FAILED" },
        )
      }
      const built = await buildSnapshotBatch(stocks, runKey, scanDate)
      const staged = await stageWyckoffV2SnapshotBatch({ runKey, snapshots: built.snapshots })
      return mergeNotionStagingProgress(progress, {
        created: staged.created,
        updated: staged.updated,
        skippedRows: staged.skipped,
        total: staged.total,
        providers: built.providers,
      })
    },
    summarize: (result) => ({
      created: result.created,
      updated: result.updated,
      skippedRows: result.skippedRows,
      total: result.total,
      providers: result.providers,
    }),
  })
}
