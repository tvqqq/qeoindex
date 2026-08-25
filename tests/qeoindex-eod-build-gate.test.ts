import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>
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
  "lib/wyckoff-v2-notion-staging.ts",
  "lib/wyckoff-v2-universe.ts",
  "lib/wyckoff-v2-universe-source.ts",
  "lib/wyckoff-notion-ingest.ts",
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
