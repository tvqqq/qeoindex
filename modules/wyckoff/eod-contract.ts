import { createHash } from "node:crypto"

import {
  WYCKOFF_V2_AGGREGATION_VERSION,
  WYCKOFF_V2_MIN_BARS,
  WYCKOFF_V2_MODEL_VERSION,
  WYCKOFF_V2_PROMPT_VERSION,
  type WyckoffV2Snapshot,
} from "./eod-builder.ts"

const TIMEFRAMES = ["1D", "1W"] as const
const SUPPORTED_EXCHANGES = new Set(["HOSE", "HNX", "UPCOM"])
const MAX_UNIVERSE_SIZE = 200
const MARKER_LABELS = new Set(["SPR", "UT", "SOS", "SOW", "TEST", "LPS", "LPSY"])
const MARKER_TONES = new Set(["bullish", "bearish", "neutral"])
const HORIZON_BY_TIMEFRAME = new Map([
  ["1D", "week"],
  ["1W", "month"],
])

export interface WyckoffV2ValidationSummary {
  total: number
  complete: number
  incomplete: number
  invalid: 0
  tickerCount: number
}

function nonEmpty(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
}

function assertCompleteSnapshot(row: WyckoffV2Snapshot) {
  if (row.historyBarCount < WYCKOFF_V2_MIN_BARS) throw new Error(`Complete snapshot has <${WYCKOFF_V2_MIN_BARS} bars: ${row.snapshotKey}`)
  if (!row.barClosedAt || !nonEmpty(row.provider) || !nonEmpty(row.sourceUrl) || !nonEmpty(row.fetchedAt)) {
    throw new Error(`Complete snapshot missing provider/timestamp evidence: ${row.snapshotKey}`)
  }
  if (typeof row.technical.price !== "number" || !Number.isFinite(row.technical.price) || row.technical.price <= 0) {
    throw new Error(`Complete snapshot price invalid: ${row.snapshotKey}`)
  }
  if (!row.phase || !row.wyckoffState || !row.taBias || !row.confidence || !row.support || !row.resistance || !row.confirmation || !row.invalidation || !row.whatChanged) {
    throw new Error(`Complete snapshot analysis fields missing: ${row.snapshotKey}`)
  }
  const probabilities = [row.bullProbability, row.baseProbability, row.bearProbability]
  if (probabilities.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`Complete snapshot probabilities missing: ${row.snapshotKey}`)
  }
  if ((row.bullProbability ?? 0) + (row.baseProbability ?? 0) + (row.bearProbability ?? 0) !== 100) {
    throw new Error(`Complete snapshot probability sum invalid: ${row.snapshotKey}`)
  }
  if (row.scenarios.length !== 3 || row.scenarios.map((item) => item.key).join("|") !== "bull|base|bear") {
    throw new Error(`Complete snapshot scenarios invalid: ${row.snapshotKey}`)
  }
  const expectedHorizon = HORIZON_BY_TIMEFRAME.get(row.timeframe)
  const expectedProbabilities = [row.bullProbability, row.baseProbability, row.bearProbability]
  row.scenarios.forEach((scenario, index) => {
    if (scenario.probability !== expectedProbabilities[index]) throw new Error(`Scenario probability mismatch: ${row.snapshotKey}`)
    if (scenario.horizon !== expectedHorizon) throw new Error(`Scenario horizon mismatch: ${row.snapshotKey}`)
    if (!(scenario.target > 0) || !Array.isArray(scenario.path) || scenario.path.length < 1) throw new Error(`Scenario target/path invalid: ${row.snapshotKey}`)
  })
  for (const marker of row.markers) {
    if (!MARKER_LABELS.has(marker.label) || !MARKER_TONES.has(marker.tone)) throw new Error(`Marker invalid: ${row.snapshotKey}`)
  }
  if (row.evidence.missingReason) throw new Error(`Complete snapshot has missingReason: ${row.snapshotKey}`)
}

function assertIncompleteSnapshot(row: WyckoffV2Snapshot) {
  if (row.historyBarCount >= WYCKOFF_V2_MIN_BARS) throw new Error(`Incomplete snapshot unexpectedly has >=${WYCKOFF_V2_MIN_BARS} bars: ${row.snapshotKey}`)
  if (!nonEmpty(row.evidence.missingReason)) throw new Error(`Incomplete snapshot missing missingReason: ${row.snapshotKey}`)
  if (row.evidence.completedBars !== row.historyBarCount) throw new Error(`Incomplete completedBars mismatch: ${row.snapshotKey}`)
  const analysisValues = [
    row.phase,
    row.wyckoffState,
    row.taBias,
    row.confidence,
    row.bullProbability,
    row.baseProbability,
    row.bearProbability,
    row.support,
    row.resistance,
    row.confirmation,
    row.invalidation,
    row.whatChanged,
  ]
  if (analysisValues.some((value) => value !== null)) throw new Error(`Incomplete snapshot contains fabricated analysis: ${row.snapshotKey}`)
  if (Object.keys(row.technical).length || row.markers.length || row.scenarios.length) throw new Error(`Incomplete snapshot contains fabricated payload: ${row.snapshotKey}`)
}

export function validateWyckoffV2SnapshotSet(runKey: string, snapshots: WyckoffV2Snapshot[]): WyckoffV2ValidationSummary {
  if (!snapshots.length || snapshots.length % TIMEFRAMES.length !== 0) {
    throw new Error(`Snapshot count must be a positive multiple of ${TIMEFRAMES.length}; received ${snapshots.length}`)
  }
  const expectedTickerCount = snapshots.length / TIMEFRAMES.length
  if (expectedTickerCount < 1 || expectedTickerCount > MAX_UNIVERSE_SIZE) {
    throw new Error(`Ticker count must be between 1 and ${MAX_UNIVERSE_SIZE}; received ${expectedTickerCount}`)
  }

  const keys = new Set<string>()
  const tickerFrames = new Map<string, Set<string>>()
  let complete = 0
  let incomplete = 0

  for (const row of snapshots) {
    if (row.runKey !== runKey) throw new Error(`Run Key mismatch: ${row.snapshotKey}`)
    if (row.snapshotKey !== `${runKey}|${row.ticker}|${row.timeframe}`) throw new Error(`Snapshot Key mismatch: ${row.snapshotKey}`)
    if (keys.has(row.snapshotKey)) throw new Error(`Duplicate Snapshot Key: ${row.snapshotKey}`)
    keys.add(row.snapshotKey)
    if (!(TIMEFRAMES as readonly string[]).includes(row.timeframe)) throw new Error(`Invalid timeframe: ${row.snapshotKey}`)
    if (!SUPPORTED_EXCHANGES.has(String(row.exchange || "").toUpperCase())) throw new Error(`Unsupported exchange snapshot: ${row.snapshotKey}`)
    if (row.validationStatus !== "Valid" || row.validationError) throw new Error(`Invalid snapshot status: ${row.snapshotKey}`)
    if (row.modelVersion !== WYCKOFF_V2_MODEL_VERSION || row.aggregationVersion !== WYCKOFF_V2_AGGREGATION_VERSION || row.promptVersion !== WYCKOFF_V2_PROMPT_VERSION) {
      throw new Error(`Version mismatch: ${row.snapshotKey}`)
    }
    if (row.evidence.completedBars !== row.historyBarCount) throw new Error(`completedBars mismatch: ${row.snapshotKey}`)
    if (!nonEmpty(row.evidence.provider) || !nonEmpty(row.evidence.sourceUrl) || !nonEmpty(row.evidence.fetchedAt)) throw new Error(`Evidence provenance missing: ${row.snapshotKey}`)

    const frames = tickerFrames.get(row.ticker) ?? new Set<string>()
    if (frames.has(row.timeframe)) throw new Error(`Duplicate ticker timeframe: ${row.snapshotKey}`)
    frames.add(row.timeframe)
    tickerFrames.set(row.ticker, frames)

    if (row.historyStatus === "Complete") {
      assertCompleteSnapshot(row)
      complete += 1
    } else if (row.historyStatus === "Incomplete") {
      assertIncompleteSnapshot(row)
      incomplete += 1
    } else {
      throw new Error(`Unsupported History Status: ${row.snapshotKey}`)
    }
  }

  if (keys.size !== snapshots.length) throw new Error(`Expected ${snapshots.length} unique Snapshot Keys; received ${keys.size}`)
  if (tickerFrames.size !== expectedTickerCount) throw new Error(`Expected ${expectedTickerCount} tickers; received ${tickerFrames.size}`)
  for (const [ticker, frames] of tickerFrames) {
    if (frames.size !== TIMEFRAMES.length || TIMEFRAMES.some((timeframe) => !frames.has(timeframe))) {
      throw new Error(`${ticker} does not have both Daily and Weekly timeframes`)
    }
  }
  if (complete + incomplete !== snapshots.length) throw new Error(`Complete + genuine Incomplete must equal ${snapshots.length}`)

  return { total: snapshots.length, complete, incomplete, invalid: 0, tickerCount: expectedTickerCount }
}

export function computeWyckoffV2ValidationHash(snapshots: Pick<WyckoffV2Snapshot, "snapshotKey" | "barClosedAt" | "historyStatus">[]) {
  const lines = snapshots
    .map((row) => `${row.snapshotKey}|${row.barClosedAt ?? ""}|${row.historyStatus}`)
    .sort((a, b) => a.localeCompare(b))
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex")
}
