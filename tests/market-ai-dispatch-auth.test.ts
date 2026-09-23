import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("Market AI dispatch and Edge verification share the Vault-backed credential contract", () => {
  const edge = source("supabase/functions/market-ai-conclusion/index.ts")
  const migration = source("supabase/migrations/20260903113000_qeo56_market_ai_dispatch_vault_auth.sql")

  assert.match(migration, /qeo_verify_market_ai_dispatch_secret/)
  assert.match(migration, /market_ai_conclusion_secret/)
  assert.match(migration, /market_ai_supabase_url/)
  assert.doesNotMatch(migration, /app\.settings\.supabase_url/)
  assert.match(edge, /qeo_verify_market_ai_dispatch_secret/)
  assert.doesNotMatch(edge, /Deno\.env\.get\("MARKET_AI_CONCLUSION_SECRET"\)/)
})

test("QEO-220 preserves sanitized post-start terminal cause", () => {
  const relativePath = "supabase/migrations/20260914102000_qeo220_preserve_market_ai_terminal_cause.sql"
  const url = new URL(`../${relativePath}`, import.meta.url)
  assert.equal(existsSync(url), true, "QEO-220 corrective migration must exist")

  const migration = source(relativePath)
  assert.match(migration, /status\s*=\s*'completion_unknown'/i)
  assert.match(migration, /error_code\s*=\s*p_error_code/i)
  assert.doesNotMatch(migration, /error_code\s*=\s*'MODEL_COMPLETION_UNKNOWN'/i)
  assert.match(migration, /model_started_at\s+is\s+not\s+null/i)
})
