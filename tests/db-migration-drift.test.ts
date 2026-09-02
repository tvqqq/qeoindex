import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import { parseMigrationFilename, reconcileMigrations } from "../scripts/db/migration-drift-lib.mjs"

test("parseMigrationFilename extracts version and logical name", () => {
  assert.deepEqual(
    parseMigrationFilename("20260902011529_clean_rebuild_market_snapshot_trigger.sql"),
    { version: "20260902011529", logicalName: "clean_rebuild_market_snapshot_trigger" },
  )
})

test("mapped timestamp mismatch passes only when explicitly declared", () => {
  const result = reconcileMigrations({
    activeFiles: ["20260902084500_ai_council_authenticated_readonly.sql"],
    pendingFiles: [],
    productionLedger: [{ version: "20260902014425", name: "ai_council_authenticated_readonly" }],
    manifest: { migrations: [{ logicalName: "ai_council_authenticated_readonly", repositoryVersion: "20260902084500", productionVersion: "20260902014425", state: "MAPPED", evidence: "ledger-logical-name" }] },
  })
  assert.equal(result.ok, true, result.errors.join("\n"))
})

test("unexplained repo-only migration fails closed", () => {
  const result = reconcileMigrations({ activeFiles: ["20260902090000_repo_only.sql"], pendingFiles: [], productionLedger: [], manifest: { migrations: [] } })
  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /repo-only/i)
})

test("unexplained production-only migration fails closed", () => {
  const result = reconcileMigrations({ activeFiles: [], pendingFiles: [], productionLedger: [{ version: "20260902090000", name: "prod_only" }], manifest: { migrations: [] } })
  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /production-only/i)
})

test("production-applied migration cannot remain pending", () => {
  const result = reconcileMigrations({
    activeFiles: [],
    pendingFiles: ["20260902090000_kfsp_rating_storage_refactor.sql"],
    productionLedger: [{ version: "20260902020424", name: "kfsp_rating_storage_refactor" }],
    manifest: { migrations: [{ logicalName: "kfsp_rating_storage_refactor", repositoryVersion: "20260902090000", productionVersion: "20260902020424", state: "MAPPED", evidence: "production-schema-contract" }] },
  })
  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /pending/i)
})

test("duplicate manifest logical names fail", () => {
  const result = reconcileMigrations({
    activeFiles: ["20260902011529_x.sql"],
    pendingFiles: [],
    productionLedger: [{ version: "20260902011529", name: "x" }],
    manifest: { migrations: [
      { logicalName: "x", repositoryVersion: "20260902011529", productionVersion: "20260902011529", state: "EXACT", evidence: "a" },
      { logicalName: "x", repositoryVersion: "20260902011529", productionVersion: "20260902011529", state: "EXACT", evidence: "b" },
    ] },
  })
  assert.equal(result.ok, false)
  assert.match(result.errors.join("\n"), /duplicate manifest/i)
})

test("current repository migration set reconciles against reviewed production ledger", () => {
  const manifest = JSON.parse(readFileSync("supabase/migration-equivalence.json", "utf8"))
  const ledger = JSON.parse(readFileSync("docs/db/evidence/production-migration-ledger-2026-09-02.json", "utf8"))
  const activeFiles = readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql"))
  const pendingFiles = existsSync("supabase/pending-migrations")
    ? readdirSync("supabase/pending-migrations").filter((name) => name.endsWith(".sql"))
    : []
  const result = reconcileMigrations({ activeFiles, pendingFiles, productionLedger: ledger.migrations, manifest })
  assert.equal(result.ok, true, result.errors.join("\n"))
})

test("db drift CLI exits zero for reviewed current state", () => {
  const run = spawnSync(process.execPath, ["scripts/db/verify-migration-drift.mjs"], { encoding: "utf8" })
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
  assert.match(run.stdout, /migration drift verification: PASS/i)
})
