import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const route = readFileSync(new URL("../../app/api/market/corporate-actions/route.ts", import.meta.url), "utf8")
const readModel = readFileSync(new URL("../../modules/market/corporate-actions/read-model.ts", import.meta.url), "utf8")

test("QEO-123 corporate-action API is authenticated, user-scoped and no-store", () => {
  assert.match(route, /requireApiUser\(\)/)
  assert.match(route, /auth\.context\.supabase/)
  assert.match(route, /readCorporateActions/)
  assert.match(route, /Cache-Control["']?\s*:\s*["']no-store["']/)
  assert.doesNotMatch(route, /getSupabaseServerClient/)
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/)
})

test("QEO-123 corporate-action API separates invalid requests from data unavailability", () => {
  assert.match(readModel, /class CorporateActionRequestError extends Error/)
  assert.match(readModel, /class CorporateActionUnavailableError extends Error/)
  assert.match(route, /instanceof CorporateActionRequestError/)
  assert.match(route, /status:\s*400/)
  assert.match(route, /instanceof CorporateActionUnavailableError/)
  assert.match(route, /status:\s*503/)
})
