import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  new URL("../supabase/migrations/20260901162500_prune_noncanonical_orderbook_snapshots.sql", import.meta.url),
  "utf8",
)

test("orderbook prune SECURITY DEFINER trigger is service-role only", () => {
  assert.match(
    migration,
    /revoke all on function public\.qeo_prune_orderbook_after_universe_publish\(\) from public, anon, authenticated/i,
  )
  assert.match(
    migration,
    /grant execute on function public\.qeo_prune_orderbook_after_universe_publish\(\) to service_role/i,
  )
})
