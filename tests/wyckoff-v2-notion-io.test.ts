import assert from "node:assert/strict"
import test from "node:test"

import type { NotionPage, NotionProperties, NotionQueryOptions, NotionQueryResult } from "../lib/notion/client.ts"
import { stageWyckoffV2SnapshotBatch } from "../lib/wyckoff-v2-notion-batch.ts"
import {
  beginWyckoffV2NotionRun,
  stageWyckoffV2Snapshots,
  validateAndFinalizeWyckoffV2NotionRun,
  WYCKOFF_V2_RUNS_DATA_SOURCE_ID,
  WYCKOFF_V2_SNAPSHOTS_DATA_SOURCE_ID,
  type WyckoffV2NotionIo,
} from "../lib/wyckoff-v2-notion-staging.ts"
import type { WyckoffV2Snapshot } from "../lib/wyckoff-v2-builder.ts"

function rich(property: unknown) {
  const value = property as { rich_text?: Array<{ text?: { content?: string } }> }
  return (value.rich_text ?? []).map((item) => item.text?.content ?? "").join("")
}

function snapshot(ticker: string, timeframe: "1H" | "4H" | "1D" | "1W" | "1M", rank: number | null): WyckoffV2Snapshot {
  const runKey = "WYCKOFF-2026-08-25-EOD-v2"
  const horizon = timeframe === "1H" ? "intraday" : timeframe === "4H" ? "swing" : timeframe === "1D" ? "week" : timeframe === "1W" ? "month" : "long_term"
  return {
    snapshot: `${ticker} · ${timeframe} · 2026-08-25`, snapshotKey: `${runKey}|${ticker}|${timeframe}`, runKey, ticker, rank,
    exchange: "HOSE", sector: "Consumer", timeframe, barClosedAt: "2026-08-25T07:45:00.000Z", historyBarCount: 80,
    historyStatus: "Complete", provider: "DNSE", providerDetail: "DNSE cached history",
    sourceUrl: `https://openapi.dnse.com.vn/price/ohlc?symbol=${ticker}&resolution=1D&type=STOCK`, fetchedAt: "2026-08-25T08:20:00.000Z",
    modelVersion: "qeo-wyckoff-rule-v1", aggregationVersion: "vn-session-v1", promptVersion: "notion-unified-v2",
    phase: "Markup / Reaccumulation watch", wyckoffState: "Cấu trúc tăng nhưng chưa có event xác nhận mới.", taBias: "Bullish", confidence: "LOW",
    bullProbability: 40, baseProbability: 35, bearProbability: 25, support: "60", resistance: "70",
    confirmation: "Breakout → Hold → Retest → Follow-through.", invalidation: "Acceptance dưới Support 60.", whatChanged: "Baseline scan.",
    technical: { price: 65, changePct: 1, volume: 1_000_000, ma20: 64, ma50: 62, ma200: 55, rsi14: 58, macd: 1, macdSignal: 0.8, atr14: 1.2, relVolume: 1.1 },
    evidence: { provider: "DNSE", providerDetail: "DNSE cached history", sourceUrl: `https://openapi.dnse.com.vn/price/ohlc?symbol=${ticker}&resolution=1D&type=STOCK`, fetchedAt: "2026-08-25T08:20:00.000Z", firstBarAt: "2025-01-01T00:00:00.000Z", lastBarAt: "2026-08-25T07:45:00.000Z", completedBars: 80, derived: timeframe !== "1H" && timeframe !== "1D", rulesTriggered: ["Above MA50"], missingReason: "" },
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
  return Array.from({ length: 100 }, (_, index) => {
    const ticker = `T${String(index + 1).padStart(3, "0")}`
    const rank = index === 20 || index === 21 ? 21 : index + 1
    return frames.map((frame) => snapshot(ticker, frame, rank))
  }).flat()
}

class MemoryNotion implements WyckoffV2NotionIo {
  runs: NotionPage[] = []
  snapshots: NotionPage[] = []
  creates = 0
  updates = 0
  private sequence = 1

  private rows(dataSourceId: string) {
    if (dataSourceId === WYCKOFF_V2_RUNS_DATA_SOURCE_ID) return this.runs
    if (dataSourceId === WYCKOFF_V2_SNAPSHOTS_DATA_SOURCE_ID) return this.snapshots
    throw new Error(`unknown data source ${dataSourceId}`)
  }

  async queryDataSource(dataSourceId: string, _options: NotionQueryOptions = {}): Promise<NotionQueryResult> {
    return { results: this.rows(dataSourceId), hasMore: false, nextCursor: null }
  }

  async createDataSourcePage(dataSourceId: string, properties: NotionProperties): Promise<NotionPage> {
    this.creates += 1
    const page = { id: `p${this.sequence++}`, properties }
    this.rows(dataSourceId).push(page)
    return page
  }

  async updatePageProperties(pageId: string, properties: NotionProperties): Promise<NotionPage> {
    this.updates += 1
    const page = [...this.runs, ...this.snapshots].find((item) => item.id === pageId)
    if (!page) throw new Error(`missing page ${pageId}`)
    page.properties = { ...(page.properties ?? {}), ...properties }
    return page
  }
}

test("v2 Notion writer creates Writing run, stages 500 rows idempotently, validates and closes Ready", async () => {
  const io = new MemoryNotion()
  const runKey = "WYCKOFF-2026-08-25-EOD-v2"
  const startedAt = "2026-08-25T08:15:00.000Z"
  const begin = await beginWyckoffV2NotionRun({ runKey, scanDate: "2026-08-25", startedAt, providerSummary: "persistent OHLCV cache" }, io)
  assert.equal(begin.status, "Writing")
  assert.equal(io.runs.length, 1)
  assert.equal((io.runs[0].properties as any).Status.select.name, "Writing")

  const snapshots = fullSet()
  const staged = await stageWyckoffV2Snapshots({ runKey, snapshots, minWriteIntervalMs: 0 }, io)
  assert.equal(staged.created, 500)
  assert.equal(staged.updated, 0)
  assert.equal(staged.skipped, 0)
  assert.equal(io.snapshots.length, 500)

  const createsAfterFirstStage = io.creates
  const rerun = await stageWyckoffV2Snapshots({ runKey, snapshots, minWriteIntervalMs: 0 }, io)
  assert.equal(rerun.created, 0)
  assert.equal(rerun.updated, 0)
  assert.equal(rerun.skipped, 500)
  assert.equal(io.creates, createsAfterFirstStage)

  const finalized = await validateAndFinalizeWyckoffV2NotionRun({
    runKey,
    scanDate: "2026-08-25",
    startedAt,
    completedAt: "2026-08-25T08:22:00.000Z",
    providerSummary: "persistent OHLCV cache",
  }, io)
  assert.equal(finalized.status, "Ready")
  assert.equal(finalized.total, 500)
  assert.equal(finalized.complete, 500)
  assert.match(finalized.validationHash, /^[a-f0-9]{64}$/)
  assert.equal((io.runs[0].properties as any).Status.select.name, "Ready")
  assert.equal(rich((io.runs[0].properties as any)["Validation Hash"]), finalized.validationHash)
})

test("durable Notion batch writer skips an unchanged 50-snapshot retry", async () => {
  const io = new MemoryNotion()
  const runKey = "WYCKOFF-2026-08-25-EOD-v2"
  const batch = fullSet().slice(0, 50)

  const first = await stageWyckoffV2SnapshotBatch({ runKey, snapshots: batch, minWriteIntervalMs: 0 }, io)
  assert.deepEqual(first, { created: 50, updated: 0, skipped: 0, total: 50 })
  const writesAfterFirst = io.creates + io.updates

  const retry = await stageWyckoffV2SnapshotBatch({ runKey, snapshots: batch, minWriteIntervalMs: 0 }, io)
  assert.deepEqual(retry, { created: 0, updated: 0, skipped: 50, total: 50 })
  assert.equal(io.creates + io.updates, writesAfterFirst)
})

test("begin stops rather than rewrites a run already Ingested", async () => {
  const io = new MemoryNotion()
  io.runs.push({ id: "r1", properties: {
    "Run Key": { rich_text: [{ type: "text", text: { content: "WYCKOFF-2026-08-25-EOD-v2" } }] },
    Status: { select: { name: "Ingested" } },
  } })
  const result = await beginWyckoffV2NotionRun({ runKey: "WYCKOFF-2026-08-25-EOD-v2", scanDate: "2026-08-25", startedAt: "2026-08-25T08:15:00.000Z", providerSummary: "cache" }, io)
  assert.equal(result.status, "Ingested")
  assert.equal(result.action, "stop")
  assert.equal(io.updates, 0)
})
