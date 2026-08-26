import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

// Focused TDD regression; the permanent assertion also lives in qeoindex-eod-pipeline.test.ts.
function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("EOD_READY freshness cutoff matches the canonical 14:45 ICT closing sync", () => {
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")
  const cron = source("supabase/migrations/20260826085500_fix_orderbook_cron_1445.sql")

  assert.match(cron, /sync-universe-eod-1445/)
  assert.match(cron, /'45 7 \* \* 1-5'/)
  assert.match(steps, /T07:45:00\.000Z/)
  assert.doesNotMatch(steps, /T07:50:00\.000Z/)
})
