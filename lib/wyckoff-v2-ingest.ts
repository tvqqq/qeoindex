import type { WyckoffV2Snapshot } from "./wyckoff-v2-builder.ts"
import { validateWyckoffV2SnapshotSet } from "./wyckoff-v2-contract.ts"

export const WYCKOFF_V2_OPERATIONAL_SOURCE = "qeoindex-notion-v2" as const

export interface WyckoffV2Membership {
  ticker: string
  rank: number | null
  exchange: string
  sector: string
}

export function validateWyckoffV2Memberships(snapshots: WyckoffV2Snapshot[]): WyckoffV2Membership[] {
  const byTicker = new Map<string, WyckoffV2Membership>()
  for (const row of snapshots) {
    const existing = byTicker.get(row.ticker)
    if (!existing) {
      byTicker.set(row.ticker, { ticker: row.ticker, rank: row.rank, exchange: row.exchange, sector: row.sector })
      continue
    }
    if (existing.exchange !== row.exchange || existing.rank !== row.rank || existing.sector !== row.sector) {
      throw new Error(`Inconsistent membership metadata for ${row.ticker}`)
    }
  }
  if (byTicker.size !== 100) throw new Error(`Expected 100 unique ticker memberships; received ${byTicker.size}`)
  const memberships = [...byTicker.values()]
  if (memberships.some((row) => row.exchange !== "HOSE")) throw new Error("Selected memberships must all be HOSE")
  return memberships.sort((a, b) => a.ticker.localeCompare(b.ticker))
}

export function buildWyckoffV2SupabasePayload(input: {
  snapshots: WyckoffV2Snapshot[]
  runId: string
  scanDate: string
  runKey: string
}) {
  const validation = validateWyckoffV2SnapshotSet(input.runKey, input.snapshots)
  const memberships = validateWyckoffV2Memberships(input.snapshots).map((row) => ({
    ...row,
    universe_key: "hose_top100",
    effective_date: input.scanDate,
    active: true,
    source: WYCKOFF_V2_OPERATIONAL_SOURCE,
  }))

  const snapshots = input.snapshots.map((row) => {
    if (!row.barClosedAt) throw new Error(`Operational snapshot requires Bar Closed At: ${row.snapshotKey}`)
    return {
      run_id: input.runId,
      ticker: row.ticker,
      timeframe: row.timeframe,
      bar_closed_at: row.barClosedAt,
      model_version: row.modelVersion,
      aggregation_version: row.aggregationVersion,
      prompt_version: row.promptVersion,
      history_bar_count: row.historyBarCount,
      history_status: row.historyStatus.toLowerCase() as "complete" | "incomplete",
      phase: row.phase,
      wyckoff_state: row.wyckoffState,
      ta_bias: row.taBias,
      confidence: row.confidence,
      bull_probability: row.bullProbability,
      base_probability: row.baseProbability,
      bear_probability: row.bearProbability,
      support: row.support,
      resistance: row.resistance,
      confirmation: row.confirmation,
      invalidation: row.invalidation,
      what_changed: row.whatChanged,
      technical: row.technical,
      evidence: row.evidence,
      markers: row.markers,
      scenarios: row.scenarios,
    }
  })

  return {
    source: WYCKOFF_V2_OPERATIONAL_SOURCE,
    memberships,
    snapshots,
    complete: validation.complete,
    incomplete: validation.incomplete,
    total: validation.total,
  }
}
