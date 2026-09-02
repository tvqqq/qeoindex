import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  new URL("../supabase/migrations/20260902011846_restrict_orderbook_prune_trigger_execute.sql", import.meta.url),
  "utf8",
)

test("orderbook prune SECURITY DEFINER trigger is service-role only", () => {
  assert.match(
    migration,
    /revoke all on function public\.qeo_prune_orderbook_after_universe_publish\(\)\s+from public, anon, authenticated/i,
  )
  assert.match(
    migration,
    /grant execute on function public\.qeo_prune_orderbook_after_universe_publish\(\)\s+to service_role/i,
  )
})
