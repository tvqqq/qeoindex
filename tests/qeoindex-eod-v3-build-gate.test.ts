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

test("archive retention remains fail-closed while implementation is delegated", () => {
  const archive = source("lib/qeoindex-eod-archive.ts")
  const legacyArchive = source("lib/qeoindex-eod-archive-legacy.ts")
  const migration = source("supabase/migrations/20260901064844_eod_archive_checkpoints.sql")
  assert.match(archive, /runEodRetentionCleanup/)
  assert.match(archive, /status:\s*"blocked"/)
  assert.match(legacyArchive, /eod_archive_checkpoints/)
  assert.match(legacyArchive, /qeo_archive_retention_preflight/)
  assert.match(migration, /create table if not exists public\.eod_archive_checkpoints/)
  assert.match(migration, /create or replace function public\.qeo_archive_retention_preflight/)
  assert.match(migration, /safe/)
  assert.match(migration, /missingDates/)
})

test("Google Drive archive delegates to the proven Shared Drive uploader", () => {
  const archive = source("lib/qeoindex-eod-archive.ts")
  const legacyArchive = source("lib/qeoindex-eod-archive-legacy.ts")
  assert.match(archive, /runLegacyDriveArchive/)
  assert.match(legacyArchive, /supportsAllDrives/)
  assert.match(legacyArchive, /includeItemsFromAllDrives/)
  assert.match(legacyArchive, /GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON/)
  assert.match(legacyArchive, /GOOGLE_DRIVE_ARCHIVE_FOLDER_ID/)
})
