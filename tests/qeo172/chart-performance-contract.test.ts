import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  createChartPerformanceRecorder,
  type ChartPerfStage,
} from "../../modules/market/chart-data/performance.ts"

const STAGES: ChartPerfStage[] = [
  "daily-db",
  "hot-db",
  "derived-cache",
  "cold-object",
  "provider-fetch",
  "aggregation",
]

function browserBenchmarkSource() {
  return readFileSync(
    new URL("../browser/qeo172-chart-performance-production.spec.ts", import.meta.url),
    "utf8",
  )
}

test("QEO-172 recorder accumulates duration and count per stage", async () => {
  let now = 0
  const recorder = createChartPerformanceRecorder(() => now)

  await recorder.measure("hot-db", async () => { now += 7 })
  await recorder.measure("hot-db", async () => { now += 5 })
  recorder.measureSync("aggregation", () => { now += 3 })

  const snapshot = recorder.snapshot()
  assert.deepEqual(snapshot["hot-db"], { durationMs: 12, count: 2 })
  assert.deepEqual(snapshot.aggregation, { durationMs: 3, count: 1 })
  for (const stage of STAGES) assert.ok(stage in snapshot)
})

test("QEO-172 production benchmark enters fullscreen from terminal state, not title metadata", () => {
  const browser = browserBenchmarkSource()

  assert.match(browser, /data-chart-maximized/)
  assert.match(browser, /toHaveAttribute\([\s\S]*?"data-chart-maximized",\s*"true"/)
  assert.doesNotMatch(browser, /\[title=\\?"Phóng to chart\\?"\]/)
})

test("QEO-172 production benchmark persists matrix evidence before adjacent navigation", () => {
  const browser = browserBenchmarkSource()
  const partialWrite = browser.indexOf("complete: false")
  const adjacentMeasure = browser.indexOf("await measureAdjacentTickerSwitches(page)")
  const completeWrite = browser.indexOf("complete: true")

  assert.ok(partialWrite >= 0, "benchmark must persist an incomplete baseline artifact")
  assert.ok(adjacentMeasure >= 0, "benchmark must measure adjacent ticker navigation")
  assert.ok(completeWrite >= 0, "benchmark must persist a completed artifact after adjacent navigation")
  assert.ok(partialWrite < adjacentMeasure, "matrix artifact must exist before adjacent navigation can fail")
  assert.ok(adjacentMeasure < completeWrite, "completed marker must only be written after adjacent navigation succeeds")
})
