import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("legacy Drive archive compatibility remains isolated from the active EOD graph", () => {
  const active = source("lib/qeoindex-eod-archive.ts")
  const legacy = source("lib/qeoindex-eod-archive-legacy.ts")
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")

  assert.match(active, /runLegacyDriveArchive/)
  assert.match(legacy, /supportsAllDrives/)
  assert.match(legacy, /includeItemsFromAllDrives/)
  assert.match(legacy, /GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON/)
  assert.match(legacy, /GOOGLE_DRIVE_ARCHIVE_FOLDER_ID/)
  assert.doesNotMatch(workflow, /runDriveArchiveStep|driveArchiveStatus|driveArchive/)
})

test("legacy per-ticker Notion archive compatibility remains isolated from the active EOD graph", () => {
  const legacy = source("lib/qeoindex-eod-archive-legacy.ts")
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")

  assert.match(legacy, /export async function archiveCanonicalUniverseBatchToNotion/)
  assert.match(legacy, /export async function archiveEodTickerBatchToNotion/)
  assert.doesNotMatch(workflow, /runNotionUniverseArchiveBatchStep|runNotionEodArchiveBatchStep|runNotionArchiveFinalizeStep/)
  assert.match(workflow, /runNotionAnalyticalSummaryStep/)
})

test("legacy archive checkpoint preflight remains available only while QEO-65 compatibility code exists", () => {
  const legacy = source("lib/qeoindex-eod-archive-legacy.ts")
  const migration = source("supabase/migrations/20260901130000_eod_archive_checkpoints.sql")

  assert.match(legacy, /qeo_archive_retention_preflight/)
  assert.match(migration, /create table if not exists public\.eod_archive_checkpoints/)
  assert.match(migration, /create or replace function public\.qeo_archive_retention_preflight/)
})
