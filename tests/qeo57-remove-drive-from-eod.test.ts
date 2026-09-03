import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("QEO-57 removes Google Drive from the active EOD workflow while preserving raw Daily retention", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const phases = source("lib/admin/job-phases.ts")
  const archive = source("lib/qeoindex-eod-archive.ts")

  assert.doesNotMatch(workflow, /runDriveArchiveStep/)
  assert.doesNotMatch(workflow, /driveArchiveStatus/)
  assert.doesNotMatch(phases, /key:\s*"DRIVE_ARCHIVE"/)
  assert.match(phases, /key:\s*"RETENTION_CLEANUP"/)
  assert.match(archive, /Raw Daily OHLCV retention is intentionally disabled/i)
  assert.doesNotMatch(archive, /\.from\("market_ohlcv_history"\)[\s\S]*?\.delete\(/)
})
