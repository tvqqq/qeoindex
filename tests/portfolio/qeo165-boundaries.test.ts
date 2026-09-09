import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"

test("QEO-165 revamp components stay presentation-only", () => {
  const files = readdirSync("components/portfolio/revamp", { recursive: true })
    .filter((name) => String(name).endsWith(".ts") || String(name).endsWith(".tsx"))
    .map((name) => `components/portfolio/revamp/${String(name)}`)

  assert.ok(files.length > 0, "revamp presentation files must exist")

  for (const file of files) {
    const source = readFileSync(file, "utf8")
    assert.doesNotMatch(source, /\bfetch\s*\(/, `${file} must not fetch`)
    assert.doesNotMatch(source, /createClient\s*\(/, `${file} must not create clients`)
    assert.doesNotMatch(source, /supabase/i, `${file} must not depend on Supabase`)
  }
})
