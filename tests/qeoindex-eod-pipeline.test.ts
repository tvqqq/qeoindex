import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

const stepsUrl = new URL("../lib/qeoindex-eod-workflow-steps.ts", import.meta.url)
const stagingStepsUrl = new URL("../lib/qeoindex-eod-notion-staging-batch.ts", import.meta.url)
const failureStepUrl = new URL("../lib/qeoindex-eod-failure-step.ts", import.meta.url)
const workflowUrl = new URL("../workflows/qeoindex-eod-pipeline.ts", import.meta.url)
const routeUrl = new URL("../app/api/qeoindex/eod/route.ts", import.meta.url)
const ingestUrl = new URL("../lib/wyckoff-notion-ingest.ts", import.meta.url)

test("unified QeoIndex EOD workflow owns the full v2 pipeline in canonical phase order", () => {
  assert.equal(existsSync(stepsUrl), true, "qeoindex-eod-workflow-steps.ts must exist")
  assert.equal(existsSync(stagingStepsUrl), true, "qeoindex-eod-notion-staging-batch.ts must exist")
  assert.equal(existsSync(failureStepUrl), true, "qeoindex-eod-failure-step.ts must exist")
  assert.equal(existsSync(workflowUrl), true, "qeoindex-eod-pipeline.ts must exist")
  if (!existsSync(workflowUrl)) return

  const code = source("workflows/qeoindex-eod-pipeline.ts")
  assert.match(code, /"use workflow"/)
  const orderedCalls = [
    "runEodReadyStep",
    "runMarketCloseCollectStep",
    "runHistoryRefreshBatchStep",
    "runEodNoTradeDailyRepairStep",
    "runWyckoffBuildStep",
    "runNotionStagingBatchStep",
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
  assert.match(code, /from "@\/lib\/qeoindex-eod-failure-step"/)
  assert.match(code, /from "@\/lib\/qeoindex-eod-no-trade-repair-step"/)
  assert.doesNotMatch(code, /runUnifiedWyckoff/)
})

test("workflow steps use v2 persistent-cache, dynamic canonical counts, Notion staging and split claim/publish boundaries", () => {
  assert.equal(existsSync(stepsUrl), true, "qeoindex-eod-workflow-steps.ts must exist")
  assert.equal(existsSync(stagingStepsUrl), true, "qeoindex-eod-notion-staging-batch.ts must exist")
  if (!existsSync(stepsUrl) || !existsSync(stagingStepsUrl)) return
  const code = source("lib/qeoindex-eod-workflow-steps.ts")
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const stagingCode = source("lib/qeoindex-eod-notion-staging-batch.ts")

  for (const required of [
    "loadWyckoffV2Universe",
    "refreshOhlcvHistoryBatch",
    "loadWyckoffV2CachedTickerHistory",
    "buildWyckoffV2TickerSnapshots",
    "beginWyckoffV2NotionRun",
    "validateAndFinalizeWyckoffV2NotionRun",
    "claimReadyWyckoffV2Run",
    "publishIngestingWyckoffV2Run",
    "runAiCouncilDailyOperation",
    "runAiCouncilDebateOperation",
    "runQeoIndexEodPhase",
  ]) {
    assert.match(code, new RegExp(required), `steps must use ${required}`)
  }
  assert.match(stagingCode, /stageWyckoffV2SnapshotBatch/)
  assert.match(stagingCode, /loadWyckoffV2CachedTickerHistory/)
  assert.match(stagingCode, /buildWyckoffV2TickerSnapshots/)
  assert.doesNotMatch(code, /refreshOhlcvHistoryUniverse/)
  assert.doesNotMatch(code, /runUnifiedWyckoff/)
  assert.match(code, /failedTickers[\s\S]*throw/i)
  assert.match(code, /const expectedSnapshots = stocks\.length \* 5/)
  assert.match(workflow, /const universeCount = ready\.stocks\.length/)
  assert.match(workflow, /const expectedSnapshots = universeCount \* WYCKOFF_TIMEFRAME_COUNT/)
  assert.match(workflow, /history\.completedTickers !== universeCount/)
  assert.match(workflow, /staging\.total !== expectedSnapshots/)
  assert.doesNotMatch(workflow, /expected 100\/100|100 tickers; 500 snapshot contract/)
})

test("v2 Supabase publisher refreshes and verifies two 1H/1D chart read models per canonical ticker before published/Ingested", () => {
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
  assert.match(code, /const expectedSeriesCount = tickers\.length \* 2/)
  assert.match(code, /chartSeries\.length !== expectedSeriesCount/)
  assert.match(code, /publishedSeriesKeys\.size !== expectedSeriesCount/)
  assert.match(code, /chartSeriesCount:\s*chartSeries\.length/)
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

test("market-close collection uses only the dedicated Vault secret and fails closed", () => {
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")
  const migration = source("supabase/migrations/20260826105000_market_close_sync_secret_rpc.sql")

  assert.match(migration, /qeo_get_market_close_sync_secret/)
  assert.match(migration, /kfsp_sync_secret/)
  assert.match(migration, /revoke all on function public\.qeo_get_market_close_sync_secret\(\) from public, anon, authenticated/i)
  assert.match(migration, /grant execute on function public\.qeo_get_market_close_sync_secret\(\) to service_role/i)
  assert.match(steps, /rpc\("qeo_get_market_close_sync_secret"\)/)
  assert.doesNotMatch(steps, /process\.env\.KFSP_SYNC_SECRET\s*\|\|\s*process\.env\.CRON_SECRET/)
  assert.match(steps, /MARKET_CLOSE_COLLECT_FAILED/)
  assert.doesNotMatch(steps, /status:\s*"degraded"\s+as const/)
})

test("HISTORY_REFRESH executes as durable batches of at most ten tickers and repairs only verified no-trade Daily gaps", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")
  const repair = source("lib/qeoindex-eod-no-trade-repair-step.ts")

  assert.match(workflow, /for \(let offset = 0; offset < ready\.stocks\.length; offset \+= 10\)/)
  assert.match(workflow, /ready\.stocks\.slice\(offset, offset \+ 10\)/)
  assert.match(workflow, /runHistoryRefreshBatchStep/)
  assert.match(workflow, /runEodNoTradeDailyRepairStep/)
  assert.doesNotMatch(workflow, /runHistoryRefreshStep\(runId, ready\.stocks/)
  assert.match(steps, /refreshOhlcvHistoryBatch/)
  assert.doesNotMatch(steps, /refreshOhlcvHistoryUniverse/)
  assert.match(steps, /completedTickers[\s\S]*requestedTickers/)
  assert.match(repair, /stock_orderbook_snapshots/)
  assert.match(repair, /volume !== 0/)
  assert.match(repair, /Math\.abs\(latestPrice - referencePrice\)/)
  assert.match(repair, /Exact EOD Daily bars incomplete after verified no-trade repair/)
})

test("NOTION_STAGING executes as durable batches of at most ten tickers with dynamic snapshot count", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const stagingSteps = source("lib/qeoindex-eod-notion-staging-batch.ts")

  const buildIndex = workflow.indexOf("runWyckoffBuildStep")
  const stagingLoopIndex = workflow.indexOf("for (let offset = 0; offset < ready.stocks.length; offset += 10)", buildIndex)
  const stagingCallIndex = workflow.indexOf("runNotionStagingBatchStep", stagingLoopIndex)
  assert.ok(stagingLoopIndex > buildIndex, "Notion staging must use its own durable batch loop after Wyckoff build")
  assert.ok(stagingCallIndex > stagingLoopIndex, "Notion staging batch step must execute inside the durable loop")
  assert.match(workflow, /ready\.stocks\.slice\(offset, offset \+ 10\)/)
  assert.doesNotMatch(workflow, /runNotionStagingStep\(runId, ready\.stocks/)
  assert.match(stagingSteps, /stageWyckoffV2SnapshotBatch/)
  assert.match(stagingSteps, /NOTION_STAGING batch must contain 1-10 tickers/)
  assert.match(workflow, /const expectedSnapshots = universeCount \* WYCKOFF_TIMEFRAME_COUNT/)
  assert.match(workflow, /staging\.total !== expectedSnapshots/)
})

test("parent workflow failure closes orphaned running phase telemetry", () => {
  const failureStep = source("lib/qeoindex-eod-failure-step.ts")

  assert.match(failureStep, /from\("system_job_phases"\)[\s\S]*status:\s*"failed"/)
  assert.match(failureStep, /\.eq\("run_id", runId\)[\s\S]*\.eq\("status", "running"\)/)
  assert.match(failureStep, /markQeoIndexEodPhaseSkipped[\s\S]*phaseKey:\s*"COMPLETE"/)
})

test("historical Ingesting runs resume the existing claim and keep the scan date through both Council phases", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")
  const backfill = source("lib/qeoindex-eod-backfill-ready-step.ts")

  assert.match(backfill, /notionSupabaseRunId/)
  assert.match(workflow, /ready\.notionAction === "resume"/)
  assert.match(workflow, /ingest\.status === "claimed" \|\| ingest\.status === "resumed"/)
  assert.match(workflow, /runDeterministicCouncilStep\(runId, published, ready\.scanDate\)/)
  assert.match(workflow, /runLlmDebateStep\(runId, published && deterministic\.ok, ready\.scanDate\)/)
  assert.match(steps, /status: "resumed" as const/)
  assert.match(steps, /runAiCouncilDailyOperation\(requiredSupabase\(\),[\s\S]*ratingDate/)
  assert.match(steps, /runAiCouncilDebateOperation\(requiredSupabase\(\), ratingDate\)/)
})

test("admin job history orders by invocation creation time so a historical backfill is shown as latest", () => {
  const admin = source("lib/admin/job-health.ts")
  const start = admin.indexOf("export async function loadAdminJobHistory")
  assert.ok(start >= 0)
  const block = admin.slice(start, start + 700)
  assert.match(block, /order\("created_at", \{ ascending: false \}\)/)
})

test("MARKET_CLOSE_COLLECT retries only transient readiness failures at +5m and +10m", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const telemetry = source("lib/admin/job-phase-telemetry.ts")

  assert.match(workflow, /MARKET_CLOSE_MAX_ATTEMPTS\s*=\s*3/)
  assert.match(workflow, /MARKET_CLOSE_RETRY_INTERVAL_MS\s*=\s*5\s*\*\s*60_000/)
  assert.match(workflow, /attempt\s*<=\s*MARKET_CLOSE_MAX_ATTEMPTS/)
  assert.match(workflow, /isRetryableMarketCloseFailure\(error\)/)
  assert.match(workflow, /sleep\(marketCloseRetryAt\(startedAtIso, attempt\)\)/)
  assert.match(workflow, /VALIDATION_FAILED/)
  assert.match(workflow, /P0_INCOMPLETE/)
  assert.match(workflow, /408/)
  assert.match(workflow, /429/)
  assert.match(workflow, />=\s*500/)
  assert.match(workflow, /failed to load dedicated sync secret[\s\S]*return false/)
  assert.match(telemetry, /markQeoIndexEodPhaseRetryingStep/)
  assert.match(telemetry, /annotateQeoIndexEodPhaseSummaryStep/)
  assert.match(telemetry, /attemptsUsed/)
  assert.match(workflow, /markQeoIndexEodPhaseRetryingStep\(/)
  assert.match(workflow, /annotateQeoIndexEodPhaseSummaryStep\(/)
})
