import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

const stepsUrl = new URL("../lib/qeoindex-eod-workflow-steps.ts", import.meta.url)
const workflowUrl = new URL("../workflows/qeoindex-eod-pipeline.ts", import.meta.url)
const routeUrl = new URL("../app/api/qeoindex/eod/route.ts", import.meta.url)
const ingestUrl = new URL("../lib/wyckoff-notion-ingest.ts", import.meta.url)

test("unified QeoIndex EOD workflow owns the full v2 pipeline in canonical phase order", () => {
  assert.equal(existsSync(stepsUrl), true, "qeoindex-eod-workflow-steps.ts must exist")
  assert.equal(existsSync(workflowUrl), true, "qeoindex-eod-pipeline.ts must exist")
  if (!existsSync(workflowUrl)) return

  const code = source("workflows/qeoindex-eod-pipeline.ts")
  assert.match(code, /"use workflow"/)
  const orderedCalls = [
    "runEodReadyStep",
    "runMarketCloseCollectStep",
    "runHistoryRefreshStep",
    "runWyckoffBuildStep",
    "runNotionStagingStep",
    "runNotionValidateStep",
    "runIngestStep",
    "runSupabasePublishStep",
    "runDeterministicCouncilStep",
    "runLlmDebateStep",
    "runCompleteStep",
  ]
  let cursor = -1
  for (const call of orderedCalls) {
    const index = code.indexOf(call, cursor + 1)
    assert.ok(index > cursor, `${call} must appear after the previous canonical phase`)
    cursor = index
  }
  assert.doesNotMatch(code, /runUnifiedWyckoff/)
})

test("workflow steps use v2 persistent-cache, Notion staging and split claim/publish boundaries", () => {
  assert.equal(existsSync(stepsUrl), true, "qeoindex-eod-workflow-steps.ts must exist")
  if (!existsSync(stepsUrl)) return
  const code = source("lib/qeoindex-eod-workflow-steps.ts")

  for (const required of [
    "loadWyckoffV2Universe",
    "refreshOhlcvHistoryUniverse",
    "loadWyckoffV2CachedTickerHistory",
    "buildWyckoffV2TickerSnapshots",
    "beginWyckoffV2NotionRun",
    "stageWyckoffV2Snapshots",
    "validateAndFinalizeWyckoffV2NotionRun",
    "claimReadyWyckoffV2Run",
    "publishIngestingWyckoffV2Run",
    "runAiCouncilDailyOperation",
    "runAiCouncilDebateOperation",
    "runQeoIndexEodPhase",
  ]) {
    assert.match(code, new RegExp(required), `steps must use ${required}`)
  }
  assert.doesNotMatch(code, /runUnifiedWyckoff/)
  assert.match(code, /failedTickers[\s\S]*throw/i)
  assert.match(code, /snapshots\.length !== 500|Expected 500/i)
})

test("v2 Supabase publisher refreshes and verifies 200 1H/1D chart read models before published/Ingested", () => {
  assert.equal(existsSync(ingestUrl), true, "wyckoff-notion-ingest.ts must exist")
  const code = source("lib/wyckoff-notion-ingest.ts")
  const loadIndex = code.indexOf("loadWyckoffV2ChartSeriesRows")
  const seriesWriteIndex = code.indexOf('from("wyckoff_chart_series")')
  const runPublishedIndex = code.indexOf('status: "published"', seriesWriteIndex)
  const notionIngestedIndex = code.indexOf('selectProperty("Ingested")', runPublishedIndex)

  assert.ok(loadIndex >= 0, "publisher must load fresh chart read models from persistent OHLCV cache")
  assert.ok(seriesWriteIndex > loadIndex, "chart series must be written after recent OHLCV load")
  assert.ok(runPublishedIndex > seriesWriteIndex, "operational run must not become published before chart-series write")
  assert.ok(notionIngestedIndex > runPublishedIndex, "Notion must not become Ingested before operational publish succeeds")
  assert.match(code, /chartSeriesCount:\s*chartSeries\.length/)
  assert.match(code, /chartSeries\.length\s*!==\s*200|expected 200/i)
})

test("new QeoIndex EOD route starts only the unified durable workflow behind machine auth", () => {
  assert.equal(existsSync(routeUrl), true, "app/api/qeoindex/eod/route.ts must exist")
  if (!existsSync(routeUrl)) return
  const code = source("app/api/qeoindex/eod/route.ts")
  assert.match(code, /start\(qeoindexEodPipeline/)
  assert.match(code, /isMachineRequestAuthorized/)
  assert.match(code, /CRON_SECRET/)
  assert.match(code, /getSupabaseServerClient/)
  assert.match(code, /qeo_verify_eod_scheduler_secret/)
  assert.match(code, /data === true/)
  assert.doesNotMatch(code, /SCANNER_RUN_SECRET/)
  assert.doesNotMatch(code, /runUnifiedWyckoff/)
})

test("admin catalog exposes one unified 15:15 ICT EOD pipeline definition", () => {
  const code = source("lib/admin/catalog.ts")
  const start = code.indexOf('key: "qeoindex.eod_pipeline"')
  assert.ok(start >= 0, "admin catalog must define qeoindex.eod_pipeline")
  const block = code.slice(start, start + 900)
  assert.match(block, /scheduleUtc:\s*"15 8 \* \* 1-5"/)
  assert.match(block, /scheduleIct:\s*"15:15 T2-T6"/)
  assert.match(block, /provider:\s*"supabase_pg_cron"/)
})

test("EOD_READY freshness cutoff matches the canonical 14:45 ICT closing sync", () => {
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")
  const cron = source("supabase/migrations/20260826085500_fix_orderbook_cron_1445.sql")

  assert.match(cron, /sync-universe-eod-1445/)
  assert.match(cron, /'45 7 \* \* 1-5'/)
  assert.match(steps, /T07:45:00\.000Z/)
  assert.doesNotMatch(steps, /T07:50:00\.000Z/)
})

test("market-close Edge auth accepts the existing Vault-backed QeoIndex cron secret fallback", () => {
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")
  const edge = source("supabase/functions/market-insight-eod-sync/index.ts")

  assert.match(steps, /KFSP_SYNC_SECRET\s*\|\|\s*process\.env\.CRON_SECRET/)
  assert.match(edge, /qeo_verify_eod_scheduler_secret/)
  assert.match(edge, /p_secret:\s*token/)
  assert.match(edge, /data\s*===\s*true/)
  assert.doesNotMatch(edge, /if \(!constantTimeEqual\(syncSecret, token\)\) return jsonResponse\(\{ ok: false, error: "UNAUTHORIZED" \}, 401\)/)
})
