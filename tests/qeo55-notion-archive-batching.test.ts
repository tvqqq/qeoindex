import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

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
