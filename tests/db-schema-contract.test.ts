import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>
}

const workflowPath = ".github/workflows/db-drift.yml"
const generatedTypesPath = "lib/supabase/database.types.ts"

test("QEO-23 exposes fail-closed database replay and generated type commands", () => {
  assert.equal(
    packageJson.scripts?.["db:types:generate"],
    "supabase gen types typescript --local --schema public > lib/supabase/database.types.ts",
  )
  assert.equal(packageJson.scripts?.["db:types:verify"], "node scripts/db/verify-generated-types.mjs")
  assert.equal(packageJson.scripts?.["db:replay:verify"], "bash scripts/db/verify-local-replay.sh")
})

test("QEO-23 commits the canonical generated Supabase Database contract", () => {
  assert.equal(existsSync(generatedTypesPath), true, `${generatedTypesPath} must be committed`)
  const generated = readFileSync(generatedTypesPath, "utf8")
  assert.match(generated, /export type Database\s*=\s*\{/)
  assert.match(generated, /public:\s*\{/)
})

test("DB drift workflow runs clean replay, generated type drift verification, and typecheck", () => {
  const workflow = readFileSync(workflowPath, "utf8")
  assert.match(workflow, /supabase\/setup-cli@v1/)
  assert.match(workflow, /pnpm db:replay:verify/)
  assert.match(workflow, /pnpm db:types:verify/)
  assert.match(workflow, /pnpm typecheck/)
  assert.match(workflow, /tests\/db-schema-contract\.test\.ts/)
})
