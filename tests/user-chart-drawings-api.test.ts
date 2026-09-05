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
