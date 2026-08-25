import type { CachedOhlcvHistory } from "./ohlcv-history-store.ts"
import type { TechnicalSnapshot } from "./technical-indicators.ts"
import type { WyckoffEventMarker, WyckoffScenario, WyckoffChartTimeframe } from "./wyckoff-chart-model.ts"
import type { WyckoffV2UniverseRow } from "./wyckoff-v2-universe.ts"

export const WYCKOFF_V2_PROMPT_VERSION = "notion-unified-v2"
export const WYCKOFF_V2_MODEL_VERSION = "qeo-wyckoff-rule-v1"
export const WYCKOFF_V2_AGGREGATION_VERSION = "vn-session-v1"

export interface WyckoffV2Evidence {
  provider: string
  providerDetail: string
  sourceUrl: string
  fetchedAt: string
  firstBarAt: string
  lastBarAt: string
  completedBars: number
  derived: boolean
  rulesTriggered: string[]
  missingReason: string
}

export interface WyckoffV2Snapshot {
  snapshot: string
  snapshotKey: string
  runKey: string
  ticker: string
  rank: number | null
  exchange: string
  sector: string
  timeframe: WyckoffChartTimeframe
  barClosedAt: string | null
  historyBarCount: number
  historyStatus: "Complete" | "Incomplete"
  provider: string
  providerDetail: string
  sourceUrl: string
  fetchedAt: string
  modelVersion: string
  aggregationVersion: string
  promptVersion: string
  phase: string | null
  wyckoffState: string | null
  taBias: "Bullish" | "Neutral" | "Bearish" | "Mixed" | null
  confidence: "HIGH" | "MEDIUM" | "LOW" | null
  bullProbability: number | null
  baseProbability: number | null
  bearProbability: number | null
  support: string | null
  resistance: string | null
  confirmation: string | null
  invalidation: string | null
  whatChanged: string | null
  technical: TechnicalSnapshot | Record<string, never>
  evidence: WyckoffV2Evidence
  markers: WyckoffEventMarker[]
  scenarios: WyckoffScenario[]
  validationStatus: "Valid"
  validationError: string
}

export function buildWyckoffV2TickerSnapshots(_args: {
  stock: WyckoffV2UniverseRow
  daily: CachedOhlcvHistory
  hourly: CachedOhlcvHistory
  runKey: string
  scanDate: string
}): WyckoffV2Snapshot[] {
  throw new Error("Wyckoff v2 cached snapshot builder is not implemented")
}
