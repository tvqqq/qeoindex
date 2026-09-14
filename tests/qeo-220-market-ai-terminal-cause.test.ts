import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

function latestCompletionUnknownDefinition() {
  const migrationsDir = path.resolve("supabase/migrations")
  const sql = fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => fs.readFileSync(path.join(migrationsDir, name), "utf8"))
    .join("\n")

  const marker = "create or replace function public.mark_market_ai_completion_unknown"
  const start = sql.lastIndexOf(marker)
  assert.notEqual(start, -1, "mark_market_ai_completion_unknown definition is missing")
  return sql.slice(start, sql.indexOf("revoke all on function public.mark_market_ai_completion_unknown", start))
}

test("QEO-220 preserves sanitized post-start terminal cause", () => {
  const definition = latestCompletionUnknownDefinition()
  assert.match(definition, /status\s*=\s*'completion_unknown'/i)
  assert.match(definition, /error_code\s*=\s*p_error_code/i)
  assert.doesNotMatch(definition, /error_code\s*=\s*'MODEL_COMPLETION_UNKNOWN'/i)
  assert.match(definition, /model_started_at\s+is\s+not\s+null/i)
})
