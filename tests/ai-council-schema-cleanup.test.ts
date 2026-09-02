import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("LLM debate identity is normalized to the deterministic Council run", () => {
  const migration = source("supabase/migrations/20260902084000_ai_council_debate_identity_cleanup.sql")
  const dashboard = source("lib/ai-council-debate-data.ts")
  const operations = source("lib/ai-council-operations.ts")

  assert.match(migration, /drop column if exists id/)
  assert.match(migration, /primary key \(run_id\)/)
  assert.doesNotMatch(dashboard, /\.select\("id,run_id/)
  assert.match(dashboard, /id: row\.run_id/)
  assert.match(operations, /\.select\("run_id", \{ count: "exact", head: true \}\)/)
})
