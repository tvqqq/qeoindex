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

test("authenticated AI Council access is explicitly read-only", () => {
  const migration = source("supabase/migrations/20260902084500_ai_council_authenticated_readonly.sql")

  for (const table of [
    "ai_council_runs",
    "ai_council_votes",
    "ai_council_outcomes",
    "ai_council_market_benchmarks",
    "ai_council_confirmations",
    "ai_council_agent_stats",
    "ai_council_llm_debates",
    "ai_council_llm_evidence",
    "ai_council_llm_research_contexts",
  ]) {
    assert.ok(migration.includes(`public.${table}`), `${table} must be included in the read-only grant migration`)
  }

  assert.match(migration, /revoke insert, update, delete, truncate, references, trigger on table/)
  assert.match(migration, /from authenticated/)
  assert.match(migration, /grant select on table/)
  assert.match(migration, /to authenticated/)
})
