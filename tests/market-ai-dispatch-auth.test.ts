import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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
