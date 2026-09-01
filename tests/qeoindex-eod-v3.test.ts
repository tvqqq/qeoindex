import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
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

test("EOD readiness is canonical-only and does not begin a Notion staging run", () => {
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")
  assert.match(steps, /getCanonicalUniverse/)
  assert.match(steps, /loadWyckoffV2Universe/)
  assert.doesNotMatch(steps, /beginWyckoffV2NotionRun/)
  assert.doesNotMatch(steps, /claimReadyWyckoffV2Run/)
  assert.doesNotMatch(steps, /publishIngestingWyckoffV2Run/)
})

test("direct Wyckoff publisher accepts in-memory validated snapshots and verifies exact canonical membership", () => {
  const path = "lib/wyckoff-supabase-publish.ts"
  assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true)
  if (!existsSync(new URL(`../${path}`, import.meta.url))) return
  const code = source(path)

  assert.match(code, /publishWyckoffV2SnapshotsDirect/)
  assert.match(code, /validateWyckoffV2SnapshotSet/)
  assert.match(code, /getCanonicalUniverse/)
  assert.match(code, /Canonical Wyckoff membership mismatch/)
  assert.match(code, /const expectedSeriesCount = tickers\.length \* 2/)
  assert.match(code, /status:\s*"published"/)
  assert.doesNotMatch(code, /queryDataSource|Notion|WYCKOFF_V2_RUNS_DATA_SOURCE_ID/)
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
})

test("retention is fail-closed behind completed Notion and Drive archive checkpoints", () => {
  const path = "lib/qeoindex-eod-archive.ts"
  assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true)
  if (!existsSync(new URL(`../${path}`, import.meta.url))) return
  const code = source(path)
  assert.match(code, /runEodRetentionCleanup/)
  assert.match(code, /notionArchive.*archived|Notion archive/i)
  assert.match(code, /driveArchive.*archived|Drive archive/i)
  assert.match(code, /blocked/i)
})
