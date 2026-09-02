import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

function qeo21RetentionMigration() {
  const migrationsDir = new URL("../supabase/migrations/", import.meta.url)
  const matches = readdirSync(migrationsDir).filter((name) => name.endsWith("_qeo21_safe_retention_cleanup.sql"))
  assert.equal(matches.length, 1, "expected exactly one QEO-21 safe retention migration")
  return source(`supabase/migrations/${matches[0]}`)
}

test("EOD v3 publishes validated Wyckoff to Supabase before Council and archives", () => {
  const workflowPath = "workflows/qeoindex-eod-pipeline.ts"
  assert.equal(existsSync(new URL(`../${workflowPath}`, import.meta.url)), true)
  const workflow = source(workflowPath)

  const ordered = [
    "runEodReadyStep",
    "runMarketCloseCollectStep",
    "runHistoryRefreshBatchStep",
    "runEodNoTradeDailyRepairStep",
    "runWyckoffBuildStep",
    "runSupabaseValidateStep",
    "runSupabasePublishStep",
    "runDeterministicCouncilStep",
    "runLlmDebateStep",
    "runMarketSynthesisStep",
    "runNotionArchiveStep",
    "runDriveArchiveStep",
    "runRetentionCleanupStep",
    "runCompleteStep",
  ]

  let cursor = -1
  for (const call of ordered) {
    const next = workflow.indexOf(call, cursor + 1)
    assert.ok(next > cursor, `${call} must appear after the prior EOD v3 phase`)
    cursor = next
  }

  assert.doesNotMatch(workflow, /runNotionStagingBatchStep/)
  assert.doesNotMatch(workflow, /runNotionValidateStep/)
  assert.doesNotMatch(workflow, /runIngestStep/)
  assert.doesNotMatch(workflow, /notionAction|notionSupabaseRunId/)
})

test("EOD readiness remains canonical-only through the delegated readiness step", () => {
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")
  const legacySteps = source("lib/qeoindex-eod-workflow-steps-legacy.ts")
  assert.match(steps, /runEodReadyStep/)
  assert.match(steps, /qeoindex-eod-workflow-steps-legacy/)
  assert.match(legacySteps, /getCanonicalUniverse/)
  assert.match(legacySteps, /loadWyckoffV2Universe/)
  assert.doesNotMatch(legacySteps, /beginWyckoffV2NotionRun/)
  assert.doesNotMatch(legacySteps, /claimReadyWyckoffV2Run/)
  assert.doesNotMatch(legacySteps, /publishIngestingWyckoffV2Run/)
})

test("EOD readiness retries known not-ready messages even when workflow wrapper drops error code", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  assert.match(workflow, /EOD_READY_MAX_ATTEMPTS = 4/)
  assert.match(workflow, /EOD_READY_RETRY_INTERVAL_MS = 5 \* 60_000/)
  assert.match(workflow, /function isEodNotReady/)
  assert.match(workflow, /EOD_NOT_READY/)
  assert.match(workflow, /FINAL EOD MARKET SNAPSHOTS INCOMPLETE/)
  assert.match(workflow, /CANONICAL RATING UNIVERSE INCOMPLETE/)
  assert.match(workflow, /KFSP\/TTAI RATING DATE/)
})

test("direct Wyckoff publisher validates 2 snapshots and one raw Daily chart series per ticker", () => {
  const path = "lib/wyckoff-supabase-publish.ts"
  assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true)
  if (!existsSync(new URL(`../${path}`, import.meta.url))) return
  const code = source(path)

  assert.match(code, /publishWyckoffV2SnapshotsDirect/)
  assert.match(code, /validateWyckoffV2SnapshotSet/)
  assert.match(code, /getCanonicalUniverse/)
  assert.match(code, /Canonical Wyckoff membership mismatch/)
  assert.match(code, /const expectedSnapshots = tickers\.length \* 2/)
  assert.match(code, /const expectedSeriesCount = tickers\.length/)
  assert.match(code, /\.in\("timeframe", \["1D"\]\)/)
  assert.match(code, /status:\s*"published"/)
  assert.doesNotMatch(code, /queryDataSource|Notion|WYCKOFF_V2_RUNS_DATA_SOURCE_ID/)
})

test("QEO-39 builds once, stages run-scoped artifacts, and keeps snapshots out of durable workflow output", () => {
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")

  assert.match(steps, /loadWyckoffV2CachedHistories/)
  assert.doesNotMatch(steps, /loadWyckoffV2CachedTickerHistory/)
  assert.equal((steps.match(/buildAllSnapshots/g) || []).length, 2, "buildAllSnapshots should only be defined and called by WYCKOFF_BUILD")
  assert.match(steps, /stageWyckoffV2BuildArtifacts/)
  assert.match(steps, /loadWyckoffV2BuildArtifacts/)
  assert.doesNotMatch(workflow, /build\.snapshots/)
  assert.match(workflow, /runSupabaseValidateStep\([\s\S]*?runId[\s\S]*?ready\.runKey[\s\S]*?ready\.scanDate[\s\S]*?build\.validationHash[\s\S]*?\)/)
  assert.match(workflow, /runSupabasePublishStep\([\s\S]*?runId[\s\S]*?ready\.runKey[\s\S]*?ready\.scanDate[\s\S]*?validation\.validationHash[\s\S]*?\)/)
})

test("admin EOD phase catalog exposes v3 order and dynamic Top Stocks descriptions", () => {
  const code = source("lib/admin/job-phases.ts")
  for (const phase of [
    "EOD_READY",
    "MARKET_CLOSE_COLLECT",
    "HISTORY_REFRESH",
    "WYCKOFF_BUILD",
    "SUPABASE_VALIDATE",
    "SUPABASE_PUBLISH",
    "AI_COUNCIL_DETERMINISTIC",
    "AI_COUNCIL_LLM",
    "MARKET_SYNTHESIS",
    "NOTION_ARCHIVE",
    "DRIVE_ARCHIVE",
    "RETENTION_CLEANUP",
    "COMPLETE",
  ]) assert.match(code, new RegExp(`key: "${phase}"`))

  assert.doesNotMatch(code, /100 ticker|500 Snapshot|NOTION_STAGING|NOTION_VALIDATE|key: "INGEST"/)
  assert.match(code, /canonical|Top Stocks|universeCount|động/i)
  assert.match(code, /1D\/1W/)
})

test("QEO-21 runs safe telemetry retention independently while raw OHLCV age-pruning stays disabled", () => {
  const active = source("lib/qeoindex-eod-archive.ts")
  const sql = qeo21RetentionMigration()

  assert.match(active, /rpc\("qeo_run_safe_retention_cleanup"/)
  assert.match(active, /Raw Daily OHLCV retention is intentionally disabled/i)
  assert.doesNotMatch(active, /\.from\("market_ohlcv_history"\)[\s\S]*?\.delete\(/)
  assert.doesNotMatch(sql, /delete\s+from\s+public\.market_ohlcv_history/i)
  assert.doesNotMatch(sql, /truncate\s+(table\s+)?public\.market_ohlcv_history/i)
})

test("QEO-21 uses schema-correct AI Council TTL columns and preserves in-flight LLM work", () => {
  const sql = qeo21RetentionMigration()

  assert.match(sql, /delete\s+from\s+public\.ai_council_llm_evidence[\s\S]*?captured_at\s*</i)
  assert.match(sql, /delete\s+from\s+public\.ai_council_llm_research_contexts[\s\S]*?captured_at\s*</i)
  assert.match(sql, /delete\s+from\s+public\.ai_council_llm_debates[\s\S]*?created_at\s*</i)
  assert.match(sql, /status\s+in\s*\(\s*'completed'\s*,\s*'partial'\s*,\s*'failed'\s*\)/i)
  assert.match(sql, /status\s*=\s*'pending'/i)
})

test("QEO-21 only prunes terminal orphan parents when cascades could remove canonical evidence", () => {
  const sql = qeo21RetentionMigration()

  assert.match(sql, /delete\s+from\s+public\.wyckoff_scan_runs[\s\S]*?not exists[\s\S]*?wyckoff_analysis_snapshots[\s\S]*?not exists[\s\S]*?wyckoff_chart_series/i)
  assert.match(sql, /delete\s+from\s+public\.ai_council_runs[\s\S]*?not exists[\s\S]*?ai_council_outcomes[\s\S]*?not exists[\s\S]*?ai_council_confirmations[\s\S]*?not exists[\s\S]*?ai_council_votes/i)
  assert.match(sql, /delete\s+from\s+public\.system_job_runs[\s\S]*?status\s+in\s*\(\s*'succeeded'\s*,\s*'failed'\s*,\s*'skipped'\s*\)/i)
})

test("QEO-21 cleans terminal staging and reports idempotency-friendly per-table metrics", () => {
  const sql = qeo21RetentionMigration()

  assert.match(sql, /delete\s+from\s+public\.kfsp_rating_staging/i)
  assert.match(sql, /delete\s+from\s+public\.market_insight_snapshot_staging/i)
  assert.match(sql, /deletedRows/i)
  assert.match(sql, /oldestRetainedAt/i)
  assert.match(sql, /cutoff/i)
  assert.match(sql, /durationMs/i)
  assert.match(sql, /kfsp_rating_raw_evidence[\s\S]*?expires_at\s*</i)
  assert.doesNotMatch(sql, /delete\s+from\s+public\.kfsp_rating_raw_evidence/i)
})
