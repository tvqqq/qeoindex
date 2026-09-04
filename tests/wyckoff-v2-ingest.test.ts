import assert from "node:assert/strict"
import test from "node:test"

import {
  buildWyckoffV2SupabasePayload,
  validateWyckoffV2Memberships,
} from "../modules/wyckoff/eod-ingest.ts"
import type { WyckoffV2Snapshot } from "../modules/wyckoff/eod-builder.ts"

function completeSnapshot(ticker: string, timeframe: WyckoffV2Snapshot["timeframe"], rank: number | null): WyckoffV2Snapshot {
  const runKey = "WYCKOFF-2026-08-25-EOD-v3"
  const horizon = timeframe === "1D" ? "week" : "month"
  return {
    snapshot: `${ticker} · ${timeframe} · 2026-08-25`, snapshotKey: `${runKey}|${ticker}|${timeframe}`, runKey, ticker, rank,
    exchange: "HOSE", sector: "Consumer", timeframe, barClosedAt: "2026-08-25T07:45:00.000Z", historyBarCount: 80,
    historyStatus: "Complete", provider: "DNSE", providerDetail: "cache", sourceUrl: "https://openapi.dnse.com.vn/history", fetchedAt: "2026-08-25T08:20:00.000Z",
    modelVersion: "qeo-wyckoff-rule-v1", aggregationVersion: "vn-session-v1", promptVersion: "notion-unified-v2",
    phase: "Markup / Reaccumulation watch", wyckoffState: "Cấu trúc tăng.", taBias: "Bullish", confidence: "LOW",
    bullProbability: 40, baseProbability: 35, bearProbability: 25, support: "60", resistance: "70", confirmation: "Hold", invalidation: "Lose Support", whatChanged: "Baseline",
    technical: { price: 65, changePct: 1, volume: 1_000_000, ma20: 64, ma50: 62, ma200: 55, rsi14: 58, macd: 1, macdSignal: 0.8, atr14: 1.2, relVolume: 1.1 },
    evidence: { provider: "DNSE", providerDetail: "cache", sourceUrl: "https://openapi.dnse.com.vn/history", fetchedAt: "2026-08-25T08:20:00.000Z", firstBarAt: "2025-01-01T00:00:00.000Z", lastBarAt: "2026-08-25T07:45:00.000Z", completedBars: 80, derived: timeframe === "1W", rulesTriggered: [], missingReason: "" },
    markers: [],
    scenarios: [
      { key: "bull", label: "Bull", probability: 40, color: "#0", target: 72, path: [{ time: 1, value: 65 }], description: "Bull", horizon, trigger: "Breakout", confirmation: "Hold", invalidation: "Lose", evidence: [] },
      { key: "base", label: "Base", probability: 35, color: "#0", target: 66, path: [{ time: 1, value: 65 }], description: "Base", horizon, trigger: "Range", confirmation: "Range", invalidation: "Break", evidence: [] },
      { key: "bear", label: "Bear", probability: 25, color: "#0", target: 58, path: [{ time: 1, value: 65 }], description: "Bear", horizon, trigger: "Breakdown", confirmation: "Hold", invalidation: "Reclaim", evidence: [] },
    ], validationStatus: "Valid", validationError: "",
  }
}

function fullSet() {
  const frames = ["1D", "1W"] as const
  const rows = Array.from({ length: 200 }, (_, index) => {
    const ticker = `T${String(index + 1).padStart(3, "0")}`
    const rank = index === 20 || index === 21 ? 21 : index + 1
    return frames.map((frame) => completeSnapshot(ticker, frame, rank))
  }).flat()
  const weekly = rows.find((row) => row.ticker === "T200" && row.timeframe === "1W")!
  weekly.historyBarCount = 24
  weekly.historyStatus = "Incomplete"
  weekly.phase = null
  weekly.wyckoffState = null
  weekly.taBias = null
  weekly.confidence = null
  weekly.bullProbability = null
  weekly.baseProbability = null
  weekly.bearProbability = null
  weekly.support = null
  weekly.resistance = null
  weekly.confirmation = null
  weekly.invalidation = null
  weekly.whatChanged = null
  weekly.technical = {}
  weekly.markers = []
  weekly.scenarios = []
  weekly.evidence.completedBars = 24
  weekly.evidence.missingReason = "Only 24 completed bars; minimum 60 completed bars required for 1W."
  return rows
}

test("v2 membership validation keeps duplicate Rank anomalies as data, not ingest blockers", () => {
  const snapshots = fullSet()
  const memberships = validateWyckoffV2Memberships(snapshots)
  assert.equal(memberships.length, 200)
  assert.equal(new Set(memberships.map((row) => row.ticker)).size, 200)
  assert.equal(memberships.filter((row) => row.rank === 21).length, 2)
})

test("v2 Supabase payload preserves all 400 Daily Weekly snapshots including genuine Incomplete", () => {
  const snapshots = fullSet()
  const payload = buildWyckoffV2SupabasePayload({ snapshots, runId: "11111111-1111-4111-8111-111111111111", scanDate: "2026-08-25", runKey: "WYCKOFF-2026-08-25-EOD-v3" })
  assert.equal(payload.memberships.length, 200)
  assert.equal(payload.snapshots.length, 400)
  assert.equal(payload.complete, 399)
  assert.equal(payload.incomplete, 1)
  assert.equal(payload.source, "qeoindex-notion-v2")
  assert.ok(payload.snapshots.every((row) => row.prompt_version === "notion-unified-v2"))
  assert.ok(payload.snapshots.every((row) => row.timeframe === "1D" || row.timeframe === "1W"))
  const incomplete = payload.snapshots.find((row) => row.ticker === "T200" && row.timeframe === "1W")!
  assert.equal(incomplete.history_status, "incomplete")
  assert.equal(incomplete.phase, null)
  assert.equal(incomplete.bull_probability, null)
  assert.deepEqual(incomplete.technical, {})
  assert.match(String((incomplete.evidence as any).missingReason), /24 completed bars/i)
})
