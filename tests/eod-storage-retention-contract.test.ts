import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

function retentionMigration() {
  const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  const name = migrations.find((entry) => entry.endsWith("_qeo21_safe_retention_cleanup.sql"))
  assert.ok(name, "safe retention migration must exist")
  return source(`supabase/migrations/${name}`)
}

test("active EOD retention is Supabase-first and never deletes canonical raw Daily OHLCV", () => {
  const archive = source("lib/qeoindex-eod-archive.ts")
  const step = source("lib/qeoindex-eod-retention-step.ts")
  const sql = retentionMigration()

  assert.match(archive, /qeo_run_safe_retention_cleanup/)
  assert.match(archive, /Raw Daily OHLCV retention is intentionally disabled/i)
  assert.doesNotMatch(archive, /\.from\("market_ohlcv_history"\)[\s\S]*?\.delete\(/i)
  assert.doesNotMatch(sql, /delete\s+from\s+public\.market_ohlcv_history/i)
  assert.doesNotMatch(sql, /truncate\s+(table\s+)?public\.market_ohlcv_history/i)
  assert.match(step, /runEodRetentionCleanup/)
  assert.doesNotMatch(step, /runEodDriveArchive|archiveEodRunToNotion|notionArchive/)
})

test("safe retention prunes only terminal/transient evidence and preserves in-flight AI work", () => {
  const sql = retentionMigration()

  assert.match(sql, /delete\s+from\s+public\.ai_council_llm_evidence[\s\S]*?captured_at\s*</i)
  assert.match(sql, /delete\s+from\s+public\.ai_council_llm_research_contexts[\s\S]*?captured_at\s*</i)
  assert.match(sql, /status\s+in\s*\(\s*'completed'\s*,\s*'partial'\s*,\s*'failed'\s*\)/i)
  assert.match(sql, /status\s*=\s*'pending'/i)
  assert.match(sql, /delete\s+from\s+public\.kfsp_rating_staging/i)
  assert.match(sql, /delete\s+from\s+public\.market_insight_snapshot_staging/i)
  assert.match(sql, /deletedRows/i)
  assert.match(sql, /oldestRetainedAt/i)
})

test("direct Wyckoff publish keeps two analysis snapshots and one raw Daily chart series per ticker", () => {
  const path = "lib/wyckoff-supabase-publish.ts"
  assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true)
  const code = source(path)

  assert.match(code, /publishWyckoffV2SnapshotsDirect/)
  assert.match(code, /validateWyckoffV2SnapshotSet/)
  assert.match(code, /const expectedSnapshots = tickers\.length \* 2/)
  assert.match(code, /const expectedSeriesCount = tickers\.length/)
  assert.match(code, /\.in\("timeframe", \["1D"\]\)/)
  assert.doesNotMatch(code, /WYCKOFF_V2_RUNS_DATA_SOURCE_ID/)
})

test("Notion is a downstream analytical summary, not operational retention state", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const summary = source("lib/qeoindex-eod-notion-summary.ts")

  const retention = workflow.indexOf("runRetentionCleanupStep")
  const notion = workflow.indexOf("runNotionAnalyticalSummaryStep", retention)
  const complete = workflow.indexOf("runCompleteStep", notion)
  assert.ok(retention >= 0 && notion > retention && complete > notion)
  assert.match(summary, /operational EOD evidence remains canonical in Supabase/i)
  assert.doesNotMatch(workflow, /runNotionUniverseArchiveBatchStep|runNotionEodArchiveBatchStep|runDriveArchiveStep/)
})
