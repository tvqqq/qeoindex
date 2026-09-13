import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const validatorUrl = new URL("../scripts/verify-test-contracts.mjs", import.meta.url)
const manifestUrl = new URL("./test-contracts.json", import.meta.url)

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

function escaped(value: string) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
}

test("test contract manifest exactly covers the current top-level test inventory", async () => {
  assert.equal(existsSync(validatorUrl), true, "validator must exist")
  assert.equal(existsSync(manifestUrl), true, "test-contracts manifest must exist")

  const { validateTestContracts } = await import(validatorUrl.href)
  const result = validateTestContracts(new URL("..", import.meta.url))

  assert.equal(result.ok, true)
  assert.deepEqual(result.missing, [])
  assert.deepEqual(result.extra, [])
  assert.deepEqual(result.duplicates, [])
  assert.deepEqual(result.invalid, [])
})

test("artifact build is Next-only while release verification remains explicit", () => {
  const pkg = JSON.parse(source("package.json")) as { scripts: Record<string, string> }
  assert.equal(pkg.scripts.build, "next build")
  assert.equal("prebuild" in pkg.scripts, false)
  assert.equal("verify:build" in pkg.scripts, false)
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /test:eod-v2|test:eod-v3/)

  const pr = pkg.scripts["verify:pr"] || ""
  for (const command of ["scan:secrets", "test:manifest", "test:current", "lint:touched", "typecheck"]) {
    assert.match(pr, escaped(command), command)
  }

  const full = pkg.scripts["verify:full"] || ""
  for (const command of ["verify:pr", "db:drift:verify", "db:replay:verify", "db:types:verify", "test:db-drift"]) {
    assert.match(full, escaped(command), command)
  }
})

test("GitHub verification runs the deduplicated current suite while targeted workflows retain domain gates", () => {
  const verify = source(".github/workflows/security.yml")
  for (const command of [
    "pnpm test:current",
    "pnpm lint:touched",
    "pnpm typecheck",
    "pnpm scan:secrets",
    "pnpm exec next build",
  ]) assert.match(verify, escaped(command), command)
  assert.doesNotMatch(verify, /pnpm test:(?:manifest|fast|eod|ai|db|ui-contracts)\b/)
  assert.doesNotMatch(
    verify,
    /node --test[^\n]*(qeo-58-eod-data-refresh|market-board-filter-avg50|auth-login-handoff|orderbook-prune-security|kfsp-canonical-universe-sync|canonical-200-ui)/,
  )

  const eod = source(".github/workflows/eod-v4.yml")
  assert.match(eod, /name:\s*EOD v4/)
  assert.match(eod, /pnpm test:eod/)
  assert.doesNotMatch(eod, /node --test tests\/qeoindex-eod-v4-/)

  const db = source(".github/workflows/db-drift.yml")
  for (const evidence of [
    "scripts/db/verify-migration-drift.mjs",
    "supabase start",
    "pnpm db:replay:verify",
    "pnpm db:types:verify",
    "pnpm test:db",
    "pnpm typecheck",
    "supabase stop --no-backup",
  ]) assert.match(db, escaped(evidence), evidence)
})
