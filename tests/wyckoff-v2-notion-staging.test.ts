import assert from "node:assert/strict"
import test from "node:test"

import {
  computeWyckoffV2ValidationHash,
  validateWyckoffV2SnapshotSet,
} from "../lib/wyckoff-v2-contract.ts"
import {
  buildWyckoffV2RunProperties,
  buildWyckoffV2SnapshotProperties,
  chunkedRichTextProperty,
} from "../lib/wyckoff-v2-notion-staging.ts"
import type { WyckoffV2Snapshot } from "../lib/wyckoff-v2-builder.ts"

function snapshot(ticker: string, timeframe: "1H" | "4H" | "1D" | "1W" | "1M", rank: number | null): WyckoffV2Snapshot {
  const runKey = "WYCKOFF-2026-09-01-EOD-v2"
  const horizon = timeframe === "1H" ? "intraday" : timeframe === "4H" ? "swing" : timeframe === "1D" ? "week" : timeframe === "1W" ? "month" : "long_term"
  return {
    snapshot: `${ticker} · ${timeframe} · 2026-09-01`, snapshotKey: `${runKey}|${ticker}|${timeframe}`, runKey, ticker, rank,
    exchange: "HOSE", sector: "Consumer", timeframe, barClosedAt: "2026-09-01T07:45:00.000Z", historyBarCount: 80,
    historyStatus: "Complete", provider: "DNSE", providerDetail: "DNSE cached history",
    sourceUrl: `https://openapi.dnse.com.vn/price/ohlc?symbol=${ticker}&resolution=1D&type=STOCK`, fetchedAt: "2026-09-01T08:20:00.000Z",
    modelVersion: "qeo-wyckoff-rule-v1", aggregationVersion: "vn-session-v1", promptVersion: "notion-unified-v2",
    phase: "Markup / Reaccumulation watch", wyckoffState: "Cấu trúc tăng nhưng chưa có event xác nhận mới.", taBias: "Bullish", confidence: "LOW",
    bullProbability: 40, baseProbability: 35, bearProbability: 25, support: "60", resistance: "70",
    confirmation: "Breakout → Hold → Retest → Follow-through.", invalidation: "Acceptance dưới Support 60.", whatChanged: "Baseline scan.",
    technical: { price: 65, changePct: 1, volume: 1_000_000, ma20: 64, ma50: 62, ma200: 55, rsi14: 58, macd: 1, macdSignal: 0.8, atr14: 1.2, relVolume: 1.1 },
    evidence: { provider: "DNSE", providerDetail: "DNSE cached history", sourceUrl: `https://openapi.dnse.com.vn/price/ohlc?symbol=${ticker}&resolution=1D&type=STOCK`, fetchedAt: "2026-09-01T08:20:00.000Z", firstBarAt: "2025-01-01T00:00:00.000Z", lastBarAt: "2026-09-01T07:45:00.000Z", completedBars: 80, derived: timeframe !== "1H" && timeframe !== "1D", rulesTriggered: ["Above MA50"], missingReason: "" },
    markers: [],
    scenarios: [
      { key: "bull", label: "Bull", probability: 40, color: "#0", target: 72, path: [{ time: 1, value: 65 }, { time: 2, value: 72 }], description: "Bull case", horizon, trigger: "Breakout", confirmation: "Hold", invalidation: "Lose Support", evidence: ["Demand"] },
      { key: "base", label: "Base", probability: 35, color: "#0", target: 66, path: [{ time: 1, value: 65 }, { time: 2, value: 66 }], description: "Base case", horizon, trigger: "Range", confirmation: "No Follow-through", invalidation: "Breakout", evidence: ["Range"] },
      { key: "bear", label: "Bear", probability: 25, color: "#0", target: 58, path: [{ time: 1, value: 65 }, { time: 2, value: 58 }], description: "Bear case", horizon, trigger: "Breakdown", confirmation: "Hold below", invalidation: "Reclaim", evidence: ["Supply"] },
    ], validationStatus: "Valid", validationError: "",
  }
}

function fullSet() {
  const frames = ["1H", "4H", "1D", "1W", "1M"] as const
  return Array.from({ length: 200 }, (_, index) => {
    const ticker = `T${String(index + 1).padStart(3, "0")}`
    const rank = index === 20 || index === 21 ? 21 : index + 1
    return frames.map((frame) => snapshot(ticker, frame, rank))
  }).flat()
}

test("v2 snapshot set validates exactly 1000 unique keys while rank anomalies remain non-blocking", () => {
  const snapshots = fullSet()
  const result = validateWyckoffV2SnapshotSet("WYCKOFF-2026-09-01-EOD-v2", snapshots)
  assert.equal(result.total, 1000)
  assert.equal(result.complete, 1000)
  assert.equal(result.incomplete, 0)
  assert.equal(result.invalid, 0)
  assert.equal(result.tickerCount, 200)

  const duplicate = snapshots.slice()
  duplicate[999] = duplicate[0]
  assert.throws(() => validateWyckoffV2SnapshotSet("WYCKOFF-2026-09-01-EOD-v2", duplicate), /duplicate|unique/i)
})

test("validation hash sorts canonical lines and uses lowercase SHA-256", () => {
  const rows = [snapshot("ZZZ", "1D", 2), snapshot("AAA", "1D", 1)]
  const first = computeWyckoffV2ValidationHash(rows)
  const second = computeWyckoffV2ValidationHash(rows.slice().reverse())
  assert.equal(first, second)
  assert.match(first, /^[a-f0-9]{64}$/)
})

test("Notion rich text chunks long JSON without truncation", () => {
  const value = JSON.stringify({ evidence: "x".repeat(7200) })
  const property = chunkedRichTextProperty(value) as { rich_text: Array<{ text: { content: string } }> }
  assert.ok(property.rich_text.length > 1)
  assert.ok(property.rich_text.every((item) => item.text.content.length <= 1900))
  assert.equal(property.rich_text.map((item) => item.text.content).join(""), value)
})

test("snapshot property mapping preserves contract fields and parseable JSON", () => {
  const row = snapshot("MSN", "1D", 15)
  row.scenarios[0].description = "x".repeat(2600)
  const properties = buildWyckoffV2SnapshotProperties(row) as Record<string, any>
  assert.equal(properties.Snapshot.title[0].text.content, row.snapshot)
  assert.equal(properties["Snapshot Key"].rich_text[0].text.content, row.snapshotKey)
  assert.equal(properties.Rank.number, 15)
  assert.equal(properties.Timeframe.select.name, "1D")
  assert.equal(properties["History Status"].select.name, "Complete")
  assert.equal(properties["Bull Probability"].number, 40)
  assert.equal(properties["Validation Status"].select.name, "Valid")
  const scenarios = properties["Scenarios JSON"].rich_text.map((item: any) => item.text.content).join("")
  assert.deepEqual(JSON.parse(scenarios), row.scenarios)
})

test("run property mapping declares canonical 200-stock ownership and actual counters", () => {
  const properties = buildWyckoffV2RunProperties({
    runKey: "WYCKOFF-2026-09-01-EOD-v2", scanDate: "2026-09-01", status: "Writing",
    snapshotComplete: 0, snapshotIncomplete: 0, errorCount: 0, errorSummary: "", startedAt: "2026-09-01T08:15:00.000Z",
    providerSummary: "QeoIndex server writer · persistent OHLCV cache", validationHash: "", universeCount: 200,
  }) as Record<string, any>
  assert.equal(properties.Run.title[0].text.content, "WYCKOFF-2026-09-01-EOD-v2")
  assert.equal(properties.Status.select.name, "Writing")
  assert.equal(properties["Universe Key"].rich_text[0].text.content, "vn_top_stocks")
  assert.equal(properties["Universe Count"].number, 200)
  assert.equal(properties["Snapshot Expected"].number, 1000)
  assert.equal(properties["Prompt Version"].rich_text[0].text.content, "notion-unified-v2")
  assert.equal(properties["Model Version"].rich_text[0].text.content, "qeo-wyckoff-rule-v1")
  assert.equal(properties["Aggregation Version"].rich_text[0].text.content, "vn-session-v1")
})
