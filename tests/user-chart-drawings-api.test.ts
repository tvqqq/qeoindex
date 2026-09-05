import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("User chart drawings API route enforces authentication and validates payloads", () => {
  const code = source("app/api/user/chart-drawings/route.ts")

  // Authentication check
  assert.match(code, /requireApiUser\(\)/)
  assert.match(code, /unauthenticated: true/)

  // Ticker validation
  assert.match(code, /\[A-Z0-9\]\{2,12\}/)

  // Max payload size protection (256KB)
  assert.match(code, /MAX_PAYLOAD_BYTES = 256 \* 1024/)

  // Reads and writes to user_preferences settings JSONB
  assert.match(code, /\.from\("user_preferences"\)/)
  assert.match(code, /\.select\("settings"\)/)
  assert.match(code, /\.upsert\(/)
  assert.match(code, /onConflict: "user_id"/)

  // GET returns saved settings or fallback structure
  assert.match(code, /export async function GET/)
  assert.match(code, /export async function POST/)
})

test("User chart drawings API route enforces V2 schema validation and defensive limits", () => {
  const code = source("app/api/user/chart-drawings/route.ts")

  // Enforces max drawings count guard
  assert.match(code, /MAX_DRAWINGS_PER_TICKER/)

  // Validates schema version 2 payload via drawing domain validator
  assert.match(code, /drawingsSchemaVersion === 2/)
  assert.match(code, /validateDrawingsCollectionV2/)

  // Fallback migration for legacy payloads without silent data loss
  assert.match(code, /migrateDrawings/)
  assert.match(code, /unresolvedLegacyDrawings/)

  // Normalizes GET payloads through deserialization
  assert.match(code, /deserializeUserChartSettings/)
  assert.match(code, /drawingsSchemaVersion: 2/)
})
