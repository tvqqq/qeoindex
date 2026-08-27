import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>
}

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

const requiredCoreTests = [
  "tests/wyckoff-unified-schema.test.ts",
  "tests/wyckoff-v2-staging.test.ts",
  "tests/wyckoff-v2-notion-staging.test.ts",
  "tests/wyckoff-v2-notion-io.test.ts",
  "tests/wyckoff-v2-ingest.test.ts",
  "tests/wyckoff-v2-runtime-data.test.ts",
  "tests/wyckoff-v2-chart-series.test.ts",
  "tests/qeoindex-eod-phase-telemetry.test.ts",
  "tests/qeoindex-eod-pipeline.test.ts",
  "tests/qeoindex-eod-scheduler.test.ts",
  "tests/qeoindex-eod-build-gate.test.ts",
]

const requiredLintFiles = [
  "lib/admin/job-phase-telemetry.ts",
  "lib/wyckoff-v2-builder.ts",
  "lib/wyckoff-v2-cache-read.ts",
  "lib/wyckoff-v2-chart-series.ts",
  "lib/wyckoff-v2-contract.ts",
  "lib/wyckoff-v2-ingest.ts",
  "lib/wyckoff-v2-notion-batch.ts",
  "lib/wyckoff-v2-notion-staging.ts",
  "lib/wyckoff-v2-universe.ts",
  "lib/wyckoff-v2-universe-source.ts",
  "lib/wyckoff-notion-ingest.ts",
  "lib/qeoindex-eod-failure-step.ts",
  "lib/qeoindex-eod-notion-staging-batch.ts",
  "lib/qeoindex-eod-workflow-steps.ts",
  "workflows/qeoindex-eod-pipeline.ts",
  "app/api/qeoindex/eod/route.ts",
]

function escaped(path: string) {
  return new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
}

test("production prebuild test:core includes the notion-unified-v2 EOD contract suite", () => {
  const core = pkg.scripts["test:core"] || ""
  const eod = pkg.scripts["test:eod-v2"] || ""
  assert.match(core, /pnpm test:eod-v2/)
  for (const path of requiredCoreTests) assert.match(eod, escaped(path), path)
})

test("production lint:touched includes all new QeoIndex EOD runtime surfaces", () => {
  const script = pkg.scripts["lint:touched"] || ""
  for (const path of requiredLintFiles) assert.match(script, escaped(path), path)
})

test("historical EOD recovery uses persistent 1D OHLCV instead of mutable latest orderbook snapshots", () => {
  const backfill = source("lib/qeoindex-eod-backfill-ready-step.ts")
  const eodMarket = source("lib/ai-council-eod-market.ts")
  const eodData = source("lib/ai-council-eod-data.ts")
  const freshness = source("lib/ai-council-freshness.ts")
  const operations = source("lib/ai-council-operations.ts")

  assert.match(backfill, /market_ohlcv_history/)
  assert.doesNotMatch(backfill, /stock_orderbook_snapshots/)
  assert.match(eodMarket, /loadPersistentCouncilEodSnapshots/)
  assert.match(eodData, /loadPersistentCouncilEodSnapshots/)
  assert.match(freshness, /persistent_ohlcv/)
  assert.match(freshness, /loadPersistentCouncilEodSnapshots/)
  assert.match(operations, /persistent_ohlcv/)
})

test("persistent freshness carries Wyckoff forward only for a verified zero-volume unchanged session", () => {
  const freshness = source("lib/ai-council-freshness.ts")

  assert.match(freshness, /isPersistentNoTradeCarryForward/)
  assert.match(freshness, /total_volume[^\n]*===?\s*0|Number\([^\n]*total_volume[^\n]*\)\s*===\s*0/)
  assert.match(freshness, /latest_price/)
  assert.match(freshness, /reference_price/)
  assert.match(freshness, /wyckoff.*bar_closed_at|bar_closed_at.*wyckoff/i)
})
