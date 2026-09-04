import type { OhlcvBar } from "../../modules/shared/technical/indicators.ts"
import type { WyckoffV2Snapshot } from "./eod-builder.ts"
import { validateWyckoffV2SnapshotSet } from "./eod-contract.ts"

export const WYCKOFF_V2_OPERATIONAL_SOURCE = "qeoindex-notion-v2" as const
export const WYCKOFF_V2_UNIVERSE_KEY = "vn_top_stocks" as const
const MAX_UNIVERSE_SIZE = 200
const SUPPORTED_EXCHANGES = new Set(["HOSE", "HNX", "UPCOM"])

export interface WyckoffV2Membership {
  ticker: string
  rank: number | null
  exchange: string
  sector: string
}

export interface RecentOhlcvRow {
  ticker: string
  timeframe: "1D" | "1H"
  bar_time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  provider: string
  provider_detail: string
  source_url: string
  fetched_at: string
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
  if (!byTicker.size || byTicker.size > MAX_UNIVERSE_SIZE) throw new Error(`Expected 1-${MAX_UNIVERSE_SIZE} unique ticker memberships; received ${byTicker.size}`)
  const memberships = [...byTicker.values()]
  const unsupported = memberships.filter((row) => !SUPPORTED_EXCHANGES.has(String(row.exchange || "").toUpperCase()))
  if (unsupported.length) throw new Error(`Selected memberships contain unsupported exchange: ${unsupported.slice(0, 5).map((row) => row.ticker).join(",")}`)
  return memberships.sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || a.ticker.localeCompare(b.ticker))
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
    universe_key: WYCKOFF_V2_UNIVERSE_KEY,
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

export function buildWyckoffV2ChartSeriesRows(input: {
  rows: RecentOhlcvRow[]
  runId: string
  modelVersion?: string
  aggregationVersion?: string
}) {
  const groups = new Map<string, RecentOhlcvRow[]>()
  for (const row of input.rows) {
    if (!row.ticker || (row.timeframe !== "1D" && row.timeframe !== "1H")) continue
    const key = `${row.ticker}|${row.timeframe}`
    const bucket = groups.get(key) ?? []
    bucket.push(row)
    groups.set(key, bucket)
  }

  return [...groups.entries()].map(([key, rows]) => {
    const ordered = rows.slice().sort((a, b) => new Date(a.bar_time).getTime() - new Date(b.bar_time).getTime()).slice(-260)
    const latest = ordered.at(-1)
    if (!latest) throw new Error(`No OHLCV rows for ${key}`)
    const bars: OhlcvBar[] = ordered.map((row) => ({
      time: Math.floor(new Date(row.bar_time).getTime() / 1000), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume),
    }))
    if (bars.some((bar) => !Number.isFinite(bar.time) || !Number.isFinite(bar.close) || bar.time <= 0 || bar.close <= 0)) throw new Error(`Invalid OHLCV chart series for ${key}`)
    return {
      ticker: latest.ticker, timeframe: latest.timeframe, bars, provider: latest.provider, provider_detail: latest.provider_detail,
      derived: false, as_of: latest.bar_time, model_version: input.modelVersion ?? "qeo-wyckoff-rule-v1",
      aggregation_version: input.aggregationVersion ?? "vn-session-v1", run_id: input.runId, updated_at: latest.fetched_at,
    }
  }).sort((a, b) => `${a.ticker}|${a.timeframe}`.localeCompare(`${b.ticker}|${b.timeframe}`))
}
