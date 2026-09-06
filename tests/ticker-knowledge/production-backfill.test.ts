import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-119 Council backfill reads only columns that exist on production ai_council_llm_debates", () => {
  const server = source("modules/ticker-knowledge/canonical-server.ts")
  const debateSelect = server.match(/from\(COUNCIL_DEBATE_TABLE\)[\s\S]*?\.select\("([^"]+)"\)/)?.[1]
  assert.ok(debateSelect, "expected canonical Council debate selector")
  assert.equal(
    debateSelect,
    "run_id,status,prompt_version,error,completed_at,created_at",
    "Council backfill must not select the removed debate id column",
  )
})
