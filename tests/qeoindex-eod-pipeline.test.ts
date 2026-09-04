import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("one canonical EOD v4 workflow owns the active Supabase-first graph", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")

  assert.match(workflow, /export async function qeoindexEodPipeline/)
  assert.match(workflow, /"use workflow"/)
  assert.match(workflow, /architecture:\s*"supabase-first-eod-v4-dag"/)
  assert.match(workflow, /runHistoryRefreshWindowStep/)
  assert.match(workflow, /runNotionAnalyticalSummaryStep/)
  assert.doesNotMatch(
    workflow,
    /runNotionUniverseArchiveBatchStep|runNotionEodArchiveBatchStep|runNotionArchiveFinalizeStep|runDriveArchiveStep/,
  )
})

test("QeoIndex EOD route starts only the canonical durable workflow behind machine auth", () => {
  const route = source("app/api/qeoindex/eod/route.ts")

  assert.match(route, /verifyMachineRequest\(request\)/)
  assert.match(route, /start\(qeoindexEodPipeline,\s*\[startedAt\]\)/)
  assert.match(route, /workflowRunId:\s*run\.runId/)
  assert.doesNotMatch(route, /aiCouncilEodWorkflow|qeoindexEodPipelineV[123]|runUnifiedWyckoff/)
})

test("admin catalog exposes one canonical 15:15 ICT EOD pipeline definition", () => {
  const catalog = source("lib/admin/catalog.ts")
  const start = catalog.indexOf('key: "qeoindex.eod_pipeline"')
  assert.ok(start >= 0, "admin catalog must define qeoindex.eod_pipeline")
  const block = catalog.slice(start, start + 1_000)

  assert.match(block, /provider:\s*"supabase_pg_cron"/)
  assert.match(block, /scheduleUtc:\s*"15 8 \* \* 1-5"/)
  assert.match(block, /scheduleIct:\s*"15:15 T2-T6"/)
})

test("parent workflow failure closes orphaned running phase telemetry before terminalizing", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const failure = source("lib/qeoindex-eod-failure-step.ts")

  assert.match(workflow, /failQeoIndexEodRunStep/)
  assert.match(failure, /closeRunningQeoIndexEodPhases/)
  assert.match(failure, /PARENT_TERMINAL_FAILURE/)
  assert.match(failure, /failQeoIndexEodRun/)
  assert.match(failure, /TELEMETRY_PERSIST_FAILED/)
})

test("MARKET_CLOSE_COLLECT uses bounded transient retry with five-minute spacing", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")

  assert.match(workflow, /MARKET_CLOSE_MAX_ATTEMPTS\s*=\s*3/)
  assert.match(workflow, /MARKET_CLOSE_RETRY_INTERVAL_MS\s*=\s*5\s*\*\s*60_000/)
  assert.match(workflow, /isRetryableMarketCloseFailure\(error\)/)
  assert.match(workflow, /retryAt\(startedAtIso,\s*attempt,\s*MARKET_CLOSE_RETRY_INTERVAL_MS\)/)
  assert.match(workflow, /await sleep\(nextAttemptAt\)/)
  assert.match(workflow, /if \(!retryable \|\| attempt === MARKET_CLOSE_MAX_ATTEMPTS\)/)
  assert.match(workflow, /408/)
  assert.match(workflow, /429/)
  assert.match(workflow, />=\s*500/)
  assert.match(workflow, /failed to load dedicated sync secret[\s\S]*return false/)
})
