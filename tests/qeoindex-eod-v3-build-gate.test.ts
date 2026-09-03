import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>
}

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

const requiredV3Tests = [
  "tests/top-stocks-200-runtime-regression.test.ts",
  "tests/qeoindex-eod-v3.test.ts",
  "tests/qeoindex-eod-v3-phase-telemetry.test.ts",
  "tests/qeoindex-eod-v3-build-gate.test.ts",
  "tests/qeoindex-eod-scheduler.test.ts",
]

const requiredLintFiles = [
  "lib/admin/job-phases.ts",
  "lib/qeoindex-eod-archive.ts",
  "lib/qeoindex-eod-backfill-ready-step.ts",
  "lib/qeoindex-eod-no-trade-repair-step.ts",
  "lib/qeoindex-eod-retention-step.ts",
  "lib/qeoindex-eod-workflow-steps.ts",
  "lib/wyckoff-supabase-publish.ts",
  "workflows/qeoindex-eod-pipeline.ts",
]

function escaped(path: string) {
  return new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
}

test("production prebuild uses the EOD v3 contract suite", () => {
  const core = pkg.scripts["test:core"] || ""
  const v3 = pkg.scripts["test:eod-v3"] || ""
  assert.match(core, /pnpm test:eod-v3/)
  assert.doesNotMatch(core, /pnpm test:eod-v2/)
  for (const path of requiredV3Tests) assert.match(v3, escaped(path), path)
})

test("production lint gate covers all EOD v3 runtime surfaces", () => {
  const script = pkg.scripts["lint:touched"] || ""
  for (const path of requiredLintFiles) assert.match(script, escaped(path), path)
})

test("historical readiness is Supabase-first and no longer opens a Notion staging run", () => {
  const backfill = source("lib/qeoindex-eod-backfill-ready-step.ts")
  assert.match(backfill, /market_ohlcv_history|loadPersistentCouncilEodSnapshots/)
  assert.match(backfill, /getCanonicalUniverse/)
  assert.doesNotMatch(backfill, /beginWyckoffV2NotionRun|notionAction|notionSupabaseRunId/)
})

test("no-trade repair supports the full canonical max-200 universe", () => {
  const repair = source("lib/qeoindex-eod-no-trade-repair-step.ts")
  assert.match(repair, /MAX_CANONICAL_UNIVERSE_SIZE\s*=\s*200/)
  assert.doesNotMatch(repair, /tickers\.length\s*>\s*100/)
  assert.doesNotMatch(repair, /1-100 unique tickers/)
})

test("safe telemetry retention is active while raw-history retention stays fail-closed", () => {
  const archive = source("lib/qeoindex-eod-archive.ts")
  const legacyArchive = source("lib/qeoindex-eod-archive-legacy.ts")
  const migration = source("supabase/migrations/20260901130000_eod_archive_checkpoints.sql")

  assert.match(archive, /qeo_run_safe_retention_cleanup/)
  assert.match(archive, /Raw Daily OHLCV retention is intentionally disabled/i)
  assert.doesNotMatch(archive, /\.from\("market_ohlcv_history"\)[\s\S]*?\.delete\(/i)

  // Keep the proven archive coverage preflight available for a future Plan C raw
  // retention cutover, but it is no longer allowed to suppress safe telemetry TTL.
  assert.match(legacyArchive, /qeo_archive_retention_preflight/)
  assert.match(migration, /create table if not exists public\.eod_archive_checkpoints/)
  assert.match(migration, /create or replace function public\.qeo_archive_retention_preflight/)
  assert.match(migration, /safe/)
  assert.match(migration, /missingDates/)
})

test("QEO-57 removes Google Drive from the active EOD contract without enabling raw-history pruning", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const phases = source("lib/admin/job-phases.ts")
  const retentionStep = source("lib/qeoindex-eod-retention-step.ts")
  const archive = source("lib/qeoindex-eod-archive.ts")

  assert.doesNotMatch(workflow, /runDriveArchiveStep|driveArchiveStatus/)
  assert.doesNotMatch(phases, /key:\s*"DRIVE_ARCHIVE"/)
  assert.match(retentionStep, /Google Drive archive is no longer part of the active EOD workflow/)
  assert.match(archive, /Raw Daily OHLCV retention is intentionally disabled/i)
  assert.doesNotMatch(archive, /\.from\("market_ohlcv_history"\)[\s\S]*?\.delete\(/i)
})

test("QEO-42 bounded per-ticker refresh failure continues to exact-session fail-closed verification", () => {
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")

  assert.doesNotMatch(
    steps,
    /if \(result\.failedTickers > 0\) \{[\s\S]*?HISTORY_REFRESH failed for/,
    "bounded provider failures must not abort before the exact-session Daily gate",
  )
  assert.doesNotMatch(workflow, /history\.completedTickers !== universeCount/)
  assert.match(workflow, /history\.completedTickers \+ history\.failedTickers !== universeCount/)
  assert.match(workflow, /history\.requestedTickers !== universeCount/)

  const historyGate = workflow.indexOf("history.completedTickers + history.failedTickers")
  const repair = workflow.indexOf("runEodNoTradeDailyRepairStep", historyGate)
  const build = workflow.indexOf("runWyckoffBuildStep", repair)
  assert.ok(historyGate >= 0 && repair > historyGate && build > repair, "exact-session repair must remain between refresh accounting and Wyckoff build")
})

test("QEO-42 HISTORY_REFRESH telemetry keeps bounded provider failures visible", () => {
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")

  assert.match(steps, /failedTickers:\s*result\.failedTickers/)
  assert.match(steps, /limitedCoverageCount:\s*result\.limitedCoverage\.length/)
  assert.match(steps, /errors:\s*result\.errors\.slice\(0,\s*5\)/)
})

test("QEO-42 recoverable provider failures are current-session only; historical backfill stays fail-closed", () => {
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")

  assert.match(steps, /allowRecoverableFailures\s*=\s*false/)
  assert.match(steps, /result\.failedTickers > 0 && !allowRecoverableFailures/)
  assert.match(
    workflow,
    /runHistoryRefreshBatchStep\([\s\S]*?startedAtIso,[\s\S]*?history,[\s\S]*?!historicalBackfill[\s\S]*?\)/,
  )
})

test("QEO-55 partitions Notion archive work into bounded durable steps", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")

  assert.match(workflow, /const NOTION_ARCHIVE_BATCH_SIZE = 8/)
  assert.match(workflow, /runNotionUniverseArchiveBatchStep/)
  assert.match(workflow, /runNotionEodArchiveBatchStep/)
  assert.match(workflow, /runNotionArchiveFinalizeStep/)
  assert.match(workflow, /offset \+= NOTION_ARCHIVE_BATCH_SIZE/)
  assert.doesNotMatch(workflow, /\brunNotionArchiveStep\b/)

  assert.match(steps, /export async function runNotionUniverseArchiveBatchStep/)
  assert.match(steps, /export async function runNotionEodArchiveBatchStep/)
  assert.match(steps, /export async function runNotionArchiveFinalizeStep/)
  assert.match(steps, /archiveCanonicalUniverseBatchToNotion/)
  assert.match(steps, /archiveEodTickerBatchToNotion/)
  assert.match(steps, /stocks\.length > 8/)
})
